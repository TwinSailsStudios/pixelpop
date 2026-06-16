import { useEffect, useRef, useCallback } from 'react'
import { usePixels } from '../hooks/usePixels'
import { supabase } from '../lib/supabase'
import {
  GRID,
  MIN_SCALE,
  MAX_SCALE,
  DEFAULT_SCALE,
  VOID_COLOR,
} from '../lib/constants'

/**
 * The 1000x1000 board. Renders an offscreen buffer onto a viewport-sized
 * canvas with a pan/zoom transform. Pointer interactions are routed through
 * the active tool (paint / destroy / eyedropper / report).
 */
export default function PixelCanvas({ uuid, tool, color, onColorPick, onResult }) {
  const canvasRef = useRef(null)
  const frameRef = useRef(0)

  // View transform: grid->screen. scale = screen px per grid cell.
  const view = useRef({ scale: DEFAULT_SCALE, ox: 0, oy: 0 })
  const drag = useRef(null) // { x, y, moved } while panning
  // Pending destroy selection (needs 2 cells).
  const destroyBuf = useRef([])

  const requestRender = useCallback(() => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      render()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { offscreenRef, ready, sample } = usePixels(requestRender)

  // ---- rendering -----------------------------------------------------------
  const render = useCallback(() => {
    const canvas = canvasRef.current
    const off = offscreenRef.current
    if (!canvas || !off) return
    const ctx = canvas.getContext('2d')
    const { scale, ox, oy } = view.current

    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = VOID_COLOR
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.setTransform(scale, 0, 0, scale, ox, oy)
    ctx.drawImage(off, 0, 0)

    // Subtle grid lines once we're zoomed in enough to see cells clearly.
    if (scale >= 6) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'
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
  }, [offscreenRef])

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
      // Center the board on first layout.
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
  const onWheel = useCallback(
    (e) => {
      e.preventDefault()
      const canvas = canvasRef.current
      const rect = canvas.getBoundingClientRect()
      const dpr = canvas.width / rect.width
      const px = (e.clientX - rect.left) * dpr
      const py = (e.clientY - rect.top) * dpr
      const v = view.current
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor))
      // Keep the cursor anchored to the same grid point while zooming.
      v.ox = px - (px - v.ox) * (next / v.scale)
      v.oy = py - (py - v.oy) * (next / v.scale)
      v.scale = next
      requestRender()
    },
    [requestRender]
  )

  const onPointerDown = useCallback((e) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: false }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (e) => {
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
    [requestRender]
  )

  // ---- tool actions --------------------------------------------------------
  const act = useCallback(
    async (gx, gy) => {
      if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) return

      if (tool === 'eyedropper') {
        onColorPick?.(sample(gx, gy))
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
        destroyBuf.current.push({ x: gx, y: gy })
        if (destroyBuf.current.length >= 2) {
          const coords = destroyBuf.current.slice(0, 2)
          destroyBuf.current = []
          const { data } = await supabase.rpc('destroy_pixels', {
            p_id: uuid,
            p_coords: coords,
          })
          onResult?.(data)
        } else {
          onResult?.({ ok: true, info: 'select 1 more pixel to destroy' })
        }
        return
      }
      // default: place
      const { data } = await supabase.rpc('place_pixel', {
        p_id: uuid,
        p_x: gx,
        p_y: gy,
        p_color: color,
      })
      onResult?.(data)
    },
    [tool, color, uuid, sample, onColorPick, onResult]
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

  const cursor =
    tool === 'eyedropper' || tool === 'report' ? 'crosshair' : 'pointer'

  return (
    <div className="relative h-full w-full overflow-hidden bg-void">
      <canvas
        ref={canvasRef}
        style={{ cursor, touchAction: 'none' }}
        className="block h-full w-full"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => (drag.current = null)}
      />
      {!ready && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-muted">
          loading board…
        </div>
      )}
    </div>
  )
}
