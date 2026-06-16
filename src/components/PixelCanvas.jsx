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

  const { ready, applyCell, clearCell, sample, ownerAt, cellsOf, forEachIn, ensureRegion } =
    usePixels(requestRender)

  // Lazy-load the pixels under the current viewport (debounced).
  const regionTimer = useRef(0)
  const ensureView = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { scale, ox, oy } = view.current
    const minX = Math.max(0, Math.floor(-ox / scale))
    const maxX = Math.min(GRID - 1, Math.floor((canvas.width - ox) / scale))
    const minY = Math.max(0, Math.floor(-oy / scale))
    const maxY = Math.min(GRID - 1, Math.floor((canvas.height - oy) / scale))
    ensureRegion(minX, minY, maxX, maxY)
  }, [ensureRegion])
  const ensureViewSoon = useCallback(() => {
    if (regionTimer.current) return
    regionTimer.current = setTimeout(() => {
      regionTimer.current = 0
      ensureView()
    }, 150)
  }, [ensureView])

  // ---- rendering -----------------------------------------------------------
  // Draw only the cells inside the viewport, in screen space (each at least 1px
  // so art stays visible when zoomed far out of the 30k board).
  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const { scale, ox, oy } = view.current
    const W = canvas.width
    const H = canvas.height

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = boardBg || VOID_COLOR
    ctx.fillRect(0, 0, W, H)

    const minX = Math.max(0, Math.floor(-ox / scale))
    const maxX = Math.min(GRID - 1, Math.floor((W - ox) / scale))
    const minY = Math.max(0, Math.floor(-oy / scale))
    const maxY = Math.min(GRID - 1, Math.floor((H - oy) / scale))
    const px = Math.max(1, Math.ceil(scale))
    const sx = (x) => Math.round(x * scale + ox)
    const sy = (y) => Math.round(y * scale + oy)

    forEachIn(minX, minY, maxX, maxY, (x, y, color) => {
      ctx.fillStyle = color
      ctx.fillRect(sx(x), sy(y), px, px)
    })

    // highlight every (visible) pixel owned by the hovered user
    const hov = hover.current
    if (hov.owner && hov.tint) {
      const set = cellsOf(hov.owner)
      if (set) {
        ctx.fillStyle = hov.tint
        let drawn = 0
        for (const k of set) {
          const i = k.indexOf(',')
          const x = +k.slice(0, i)
          const y = +k.slice(i + 1)
          if (x >= minX && x <= maxX && y >= minY && y <= maxY) ctx.fillRect(sx(x), sy(y), px, px)
          if (++drawn > 60000) break
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
      for (const c of cells) ctx.fillRect(sx(c.x), sy(c.y), px, px)
      ctx.globalAlpha = 1
    }

    // grid lines
    if (scale >= 6) {
      ctx.strokeStyle = 'rgba(127,127,127,0.18)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let gx = minX; gx <= maxX + 1; gx++) {
        const lx = sx(gx) + 0.5
        ctx.moveTo(lx, sy(minY))
        ctx.lineTo(lx, sy(maxY + 1))
      }
      for (let gy = minY; gy <= maxY + 1; gy++) {
        const ly = sy(gy) + 0.5
        ctx.moveTo(sx(minX), ly)
        ctx.lineTo(sx(maxX + 1), ly)
      }
      ctx.stroke()
    }
  }, [boardBg, tool, color, fill, cellsOf, forEachIn])
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
      ensureView()
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [requestRender, ensureView])

  useEffect(() => {
    if (ready) {
      requestRender()
      ensureView()
    }
  }, [ready, requestRender, ensureView])

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
      ensureViewSoon()
    },
    [requestRender, ensureViewSoon]
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
        ensureViewSoon()
      }
    },
    [toGrid, updateHover, requestRender, ensureViewSoon]
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
