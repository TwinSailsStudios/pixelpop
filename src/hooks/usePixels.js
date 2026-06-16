import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { GRID, VOID_COLOR } from '../lib/constants'

/**
 * Keeps a 1000x1000 offscreen canvas as the single source of truth for pixel
 * colors. Initial state is paged in from the DB; live changes arrive over
 * Supabase Realtime. Consumers read `offscreenRef.current` and blit it to the
 * visible canvas (scaled) on each animation frame.
 *
 * @param onChange called after any pixel mutation so the view can re-render.
 */
export function usePixels(onChange) {
  const offscreenRef = useRef(null)
  const ctxRef = useRef(null)
  const [ready, setReady] = useState(false)

  // Lazily create the offscreen buffer once. Voids stay transparent so the
  // themed board background (drawn on the visible canvas) shows through.
  if (!offscreenRef.current && typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = GRID
    c.height = GRID
    const ctx = c.getContext('2d', { willReadFrequently: true })
    offscreenRef.current = c
    ctxRef.current = ctx
  }

  const paint = useCallback(
    (x, y, color) => {
      const ctx = ctxRef.current
      if (!ctx) return
      if (!color || color === VOID_COLOR) {
        ctx.clearRect(x, y, 1, 1) // erase -> transparent
      } else {
        ctx.fillStyle = color
        ctx.fillRect(x, y, 1, 1)
      }
      onChange?.()
    },
    [onChange]
  )

  // Read a single cell's color (eyedropper + optimistic-revert). Returns the
  // VOID sentinel for empty cells so reverts erase rather than paint black.
  const sample = useCallback((x, y) => {
    const ctx = ctxRef.current
    if (!ctx) return VOID_COLOR
    const d = ctx.getImageData(x, y, 1, 1).data
    if (d[3] < 128) return VOID_COLOR
    return (
      '#' +
      [d[0], d[1], d[2]].map((n) => n.toString(16).padStart(2, '0')).join('')
    )
  }, [])

  useEffect(() => {
    let cancelled = false

    // Page the whole board in (1000 rows at a time stays under PostgREST caps).
    async function loadAll() {
      const page = 1000
      let from = 0
      for (;;) {
        const { data, error } = await supabase
          .from('pixels')
          .select('x,y,color')
          .range(from, from + page - 1)
        if (error || !data || cancelled) break
        for (const p of data) paint(p.x, p.y, p.color)
        if (data.length < page) break
        from += page
      }
      if (!cancelled) {
        setReady(true)
        onChange?.()
      }
    }
    loadAll()

    const channel = supabase
      .channel('pixels-stream')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pixels' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const { x, y } = payload.old
            paint(x, y, VOID_COLOR)
          } else {
            const { x, y, color } = payload.new
            paint(x, y, color)
          }
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { offscreenRef, ready, paint, sample }
}
