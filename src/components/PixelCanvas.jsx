import { useEffect, useRef, useState, useCallback } from 'react'
import { usePixels } from '../hooks/usePixels'
import { supabase } from '../lib/supabase'
import {
  GRID,
  MIN_SCALE,
  MAX_SCALE,
  DEFAULT_SCALE,
  VOID_COLOR,
} from '../lib/constants'

// --- geometry --------------------------------------------------------------
function lineCells(a, b) {
  const cells = []
  let x0 = a.x
  let y0 = a.y
  const dx = Math.abs(b.x - x0)
  const dy = -Math.abs(b.y - y0)
  const sx = x0 < b.x ? 1 : -1
  const sy = y0 < b.y ? 1 : -1
  let err = dx + dy
  for (;;) {
    cells.push({ x: x0, y: y0 })
    if (x0 === b.x && y0 === b.y) break
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x0 += sx }
    if (e2 <= dx) { err += dx; y0 += sy }
    if (cells.length > 20000) break
  }
  return cells
}

function rectCells(a, b, filled) {
  const lx = Math.min(a.x, b.x), hx = Math.max(a.x, b.x)
  const ly = Math.min(a.y, b.y), hy = Math.max(a.y, b.y)
  const cells = []
  if (filled) {
    for (let x = lx; x <= hx; x++)
      for (let y = ly; y <= hy; y++) {
        cells.push({ x, y })
        if (cells.length > 20000) return cells // guard runaway fills
      }
    return cells
  }
  for (let x = lx; x <= hx; x++) { cells.push({ x, y: ly }); cells.push({ x, y: hy }) }
  for (let y = ly + 1; y < hy; y++) { cells.push({ x: lx, y }); cells.push({ x: hx, y }) }
  return cells
}

// Stable pseudo-random tint per user so highlighting is consistent.
function tintFor(id) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return `hsla(${h % 360}, 90%, 55%, 0.5)`
}

/**
 * The 1000x1000 board. Offscreen buffer blitted with a pan/zoom transform.
 * Tools: place / line / square / destroy / eyedropper / report. Hovering a
 * pixel highlights every cell owned by that user and shows their leaderboard card.
 */
export default function PixelCanvas({ uuid, tool, color, fill, boardBg, onColorPick, onResult }) {
  const canvasRef = useRef(null)
  const frameRef = useRef(0)
  const renderRef = useRef(null)

  const view = useRef({ scale: DEFAULT_SCALE, ox: 0, oy: 0 })
  const drag = useRef(null)
  const shape = useRef({ start: null })          // line/square anchor
  const hoverCell = useRef({ x: -1, y: -1 })
  const hover = useRef({ owner: null, tint: null }) // highlighted user
  const cardCache = useRef(new Map())
  const [hoverCard, setHoverCard] = useState(null)

  // Calls the latest render via a ref so tool/color/theme changes aren't stale.
  const requestRender = useCallback(() => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      renderRef.current?.()
    })
  }, [])

  const { offscreenRef, ready, applyCell, clearCell, sample, ownerAt, cellsOf } =
    usePixels(requestRender)

  // ---- rendering -----------------------------------------------------------
  const render = useCallback(() => {
    const canvas = canvasRef.current
    const off = offscreenRef.current
    if (!canvas || !off) return
    const ctx = canvas.getContext('2d')
    const { scale, ox, oy } = view.current

    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = boardBg || VOID_COLOR
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.setTransform(scale, 0, 0, scale, ox, oy)
    ctx.drawImage(off, 0, 0)

    // highlight every pixel owned by the hovered user
    const hov = hover.current
    if (hov.owner && hov.tint) {
      const set = cellsOf(hov.owner)
      if (set) {
        ctx.fillStyle = hov.tint
        for (const k of set) {
          const i = k.indexOf(',')
          ctx.fillRect(+k.slice(0, i), +k.slice(i + 1), 1, 1)
        }
      }
    }

    // live preview for the line / square tools
    const s = shape.current
    if (s.start && (tool === 'line' || tool === 'square')) {
      const cells = tool === 'line'
        ? lineCells(s.start, hoverCell.current)
        : rectCells(s.start, hoverCell.current, fill)
      ctx.globalAlpha = 0.7
      ctx.fillStyle = color
      for (const c of cells) ctx.fillRect(c.x, c.y, 1, 1)
      ctx.globalAlpha = 1
    }

    // grid lines
    if (scale >= 6) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.strokeStyle = 'rgba(127,127,127,0.18)'
      ctx.lineWidth = 1
      ctx.beginPath()
      const startX = Math.max(0, Math.floor(-ox / scale))
      const endX = Math.min(GRID, Math.ceil((canvas.width - ox) / scale))
      const startY = Math.max(0, Math.floor(-oy / scale))
      const endY = Math.min(GRID, Math.ceil((canvas.height - oy) / scale))
      for (let gx = startX; gx <= endX; gx++) {
        const sx = Math.round(gx * scale + ox) + 0.5
        ctx.moveTo(sx, startY * scale + oy)
        ctx.lineTo(sx, endY * scale + oy)
      }
      for (let gy = startY; gy <= endY; gy++) {
        const sy = Math.round(gy * scale + oy) + 0.5
        ctx.moveTo(startX * scale + ox, sy)
        ctx.lineTo(endX * scale + ox, sy)
      }
      ctx.stroke()
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }, [offscreenRef, boardBg, tool, color, fill, cellsOf])
  renderRef.current = render

  // re-render when the theme / tool / color changes
  useEffect(() => {
    requestRender()
  }, [boardBg, tool, color, requestRender])

  // clearing the shape anchor when switching tools
  useEffect(() => {
    shape.current.start = null
    requestRender()
  }, [tool, requestRender])

  // ---- sizing --------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const rect = canvas.parentElement.getBoundingClientRect()
      canvas.width = Math.floor(rect.width * dpr)
      canvas.height = Math.floor(rect.height * dpr)
      canvas.style.width = rect.width + 'px'
      canvas.style.height = rect.height + 'px'
      if (view.current.ox === 0 && view.current.oy === 0) {
        const s = view.current.scale
        view.current.ox = canvas.width / 2 - (GRID * s) / 2
        view.current.oy = canvas.height / 2 - (GRID * s) / 2
      }
      requestRender()
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [requestRender])

  useEffect(() => {
    if (ready) requestRender()
  }, [ready, requestRender])

  // ---- coordinate mapping --------------------------------------------------
  const toGrid = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const dprX = canvas.width / rect.width
    const dprY = canvas.height / rect.height
    const px = (clientX - rect.left) * dprX
    const py = (clientY - rect.top) * dprY
    const { scale, ox, oy } = view.current
    return {
      x: Math.floor((px - ox) / scale),
      y: Math.floor((py - oy) / scale),
    }
  }, [])

  // ---- zoom / pan ----------------------------------------------------------
  const zoomAt = useCallback(
    (factor, px, py) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const cx = px ?? canvas.width / 2
      const cy = py ?? canvas.height / 2
      const v = view.current
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor))
      v.ox = cx - (cx - v.ox) * (next / v.scale)
      v.oy = cy - (cy - v.oy) * (next / v.scale)
      v.scale = next
      requestRender()
    },
    [requestRender]
  )

  const onWheel = useCallback(
    (e) => {
      e.preventDefault()
      const canvas = canvasRef.current
      const rect = canvas.getBoundingClientRect()
      const dpr = canvas.width / rect.width
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, (e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr)
    },
    [zoomAt]
  )

  // ---- hover card (owner display name + rank), cached per user -------------
  const loadCard = useCallback(async (owner) => {
    if (cardCache.current.has(owner)) {
      if (hover.current.owner === owner) setHoverCard(cardCache.current.get(owner))
      return
    }
    const { data } = await supabase.rpc('user_card', { p_id: owner })
    cardCache.current.set(owner, data)
    if (hover.current.owner === owner) setHoverCard(data)
  }, [])

  const updateHover = useCallback(
    (gx, gy) => {
      if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) return
      hoverCell.current = { x: gx, y: gy }
      const owner = ownerAt(gx, gy)
      if (owner !== hover.current.owner) {
        hover.current.owner = owner
        hover.current.tint = owner ? tintFor(owner) : null
        if (owner) loadCard(owner)
        else setHoverCard(null)
        requestRender()
      } else if (shape.current.start) {
        requestRender() // refresh shape preview as the cursor moves
      }
    },
    [ownerAt, loadCard, requestRender]
  )

  const clearHover = useCallback(() => {
    hover.current = { owner: null, tint: null }
    setHoverCard(null)
    requestRender()
  }, [requestRender])

  // ---- tool actions --------------------------------------------------------
  const act = useCallback(
    async (gx, gy) => {
      if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) return

      if (tool === 'eyedropper') {
        const c = sample(gx, gy)
        if (c !== VOID_COLOR) onColorPick?.(c)
        return
      }

      if (tool === 'report') {
        const { data } = await supabase.rpc('report_pixel', {
          p_reporter: uuid,
          p_x: gx,
          p_y: gy,
        })
        onResult?.(data)
        return
      }

      if (tool === 'destroy') {
        const prevC = sample(gx, gy)
        const prevO = ownerAt(gx, gy)
        clearCell(gx, gy) // optimistic
        const { data } = await supabase.rpc('destroy_pixels', {
          p_id: uuid,
          p_coords: [{ x: gx, y: gy }],
        })
        if (!data || data.ok === false) applyCell(gx, gy, prevC, prevO)
        onResult?.(data)
        return
      }

      if (tool === 'line' || tool === 'square') {
        if (!shape.current.start) {
          shape.current.start = { x: gx, y: gy }
          onResult?.({ ok: true, info: `${tool} anchored — click the end point` })
          requestRender()
          return
        }
        const cells =
          tool === 'line'
            ? lineCells(shape.current.start, { x: gx, y: gy })
            : rectCells(shape.current.start, { x: gx, y: gy }, fill)
        shape.current.start = null
        const prevs = cells.map((c) => ({
          ...c,
          prevC: sample(c.x, c.y),
          prevO: ownerAt(c.x, c.y),
        }))
        cells.forEach((c) => applyCell(c.x, c.y, color, uuid)) // optimistic
        const { data } = await supabase.rpc('place_pixels', {
          p_id: uuid,
          p_cells: cells.map((c) => ({ x: c.x, y: c.y, color })),
        })
        if (!data || data.ok === false) {
          prevs.forEach((p) => applyCell(p.x, p.y, p.prevC, p.prevO))
        }
        onResult?.(data)
        requestRender()
        return
      }

      // default: place a single pixel
      const prevC = sample(gx, gy)
      const prevO = ownerAt(gx, gy)
      applyCell(gx, gy, color, uuid) // optimistic
      const { data } = await supabase.rpc('place_pixel', {
        p_id: uuid,
        p_x: gx,
        p_y: gy,
        p_color: color,
      })
      if (!data || data.ok === false) applyCell(gx, gy, prevC, prevO)
      onResult?.(data)
    },
    [tool, color, fill, uuid, sample, ownerAt, applyCell, clearCell, onColorPick, onResult, requestRender]
  )

  // ---- pointer handlers ----------------------------------------------------
  const onPointerDown = useCallback((e) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: false }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (e) => {
      const { x, y } = toGrid(e.clientX, e.clientY)
      updateHover(x, y)

      const d = drag.current
      if (!d) return
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (!d.moved && Math.hypot(dx, dy) > 3) d.moved = true
      if (d.moved) {
        const canvas = canvasRef.current
        const dpr = canvas.width / canvas.getBoundingClientRect().width
        view.current.ox += dx * dpr
        view.current.oy += dy * dpr
        d.x = e.clientX
        d.y = e.clientY
        requestRender()
      }
    },
    [toGrid, updateHover, requestRender]
  )

  const onPointerUp = useCallback(
    (e) => {
      const d = drag.current
      drag.current = null
      if (d && !d.moved) {
        const { x, y } = toGrid(e.clientX, e.clientY)
        act(x, y)
      }
    },
    [toGrid, act]
  )

  return (
    <div className="relative h-full w-full overflow-hidden bg-void">
      <canvas
        ref={canvasRef}
        style={{ cursor: 'crosshair', touchAction: 'none' }}
        className="block h-full w-full"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          drag.current = null
          clearHover()
        }}
      />

      {/* hovered user's card */}
      {hoverCard && (
        <div className="pointer-events-none absolute left-2 top-2 z-20 rounded border border-edge bg-panel/90 px-3 py-2 text-xs backdrop-blur">
          <div className="text-ink">{hoverCard.display_name}</div>
          <div className="text-muted">
            #{hoverCard.rank} · {hoverCard.pixels_placed} placed ·{' '}
            {hoverCard.pixels_destroyed} destroyed
          </div>
        </div>
      )}

      {/* zoom controls */}
      <div className="absolute bottom-3 right-3 z-20 flex flex-col gap-1">
        <button
          onClick={() => zoomAt(1.4)}
          title="Zoom in"
          className="h-9 w-9 rounded border border-edge bg-panel/90 text-lg leading-none text-ink backdrop-blur hover:border-accent hover:text-accent"
        >
          +
        </button>
        <button
          onClick={() => zoomAt(1 / 1.4)}
          title="Zoom out"
          className="h-9 w-9 rounded border border-edge bg-panel/90 text-lg leading-none text-ink backdrop-blur hover:border-accent hover:text-accent"
        >
          −
        </button>
      </div>

      {!ready && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-muted">
          loading board…
        </div>
      )}
    </div>
  )
}
