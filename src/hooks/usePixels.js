import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { GRID, VOID_COLOR } from '../lib/constants'

const keyOf = (x, y) => x + ',' + y

/**
 * Keeps a 1000x1000 offscreen canvas as the source of truth for pixel colors,
 * plus two indexes for the "highlight this user's pixels" hover feature:
 *   ownerAt:      "x,y" -> owner uuid
 *   cellsByOwner: owner uuid -> Set("x,y")
 * Voids stay transparent so the themed board background shows through.
 */
export function usePixels(onChange) {
  const offscreenRef = useRef(null)
  const ctxRef = useRef(null)
  const ownerAtRef = useRef(new Map())
  const cellsByOwnerRef = useRef(new Map())
  const [ready, setReady] = useState(false)

  if (!offscreenRef.current && typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = GRID
    c.height = GRID
    ctxRef.current = c.getContext('2d', { willReadFrequently: true })
    offscreenRef.current = c
  }

  const trackOwner = (k, owner) => {
    const at = ownerAtRef.current
    const by = cellsByOwnerRef.current
    const old = at.get(k)
    if (old && old !== owner) by.get(old)?.delete(k)
    if (owner) {
      at.set(k, owner)
      let set = by.get(owner)
      if (!set) by.set(owner, (set = new Set()))
      set.add(k)
    } else {
      at.delete(k)
      if (old) by.get(old)?.delete(k)
    }
  }

  // Paint a cell to a color and record its owner.
  const applyCell = useCallback(
    (x, y, color, owner) => {
      const ctx = ctxRef.current
      if (!ctx) return
      if (!color || color === VOID_COLOR) ctx.clearRect(x, y, 1, 1)
      else {
        ctx.fillStyle = color
        ctx.fillRect(x, y, 1, 1)
      }
      trackOwner(keyOf(x, y), owner || null)
      onChange?.()
    },
    [onChange]
  )

  // Erase a cell back to void.
  const clearCell = useCallback(
    (x, y) => {
      const ctx = ctxRef.current
      if (!ctx) return
      ctx.clearRect(x, y, 1, 1)
      trackOwner(keyOf(x, y), null)
      onChange?.()
    },
    [onChange]
  )

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

  const ownerAt = useCallback((x, y) => ownerAtRef.current.get(keyOf(x, y)) || null, [])
  const cellsOf = useCallback((owner) => cellsByOwnerRef.current.get(owner), [])

  useEffect(() => {
    let cancelled = false

    async function loadAll() {
      const page = 1000
      let from = 0
      for (;;) {
        const { data, error } = await supabase
          .from('pixels')
          .select('x,y,color,owner')
          .range(from, from + page - 1)
        if (error || !data || cancelled) break
        for (const p of data) applyCell(p.x, p.y, p.color, p.owner)
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
            clearCell(x, y)
          } else {
            const { x, y, color, owner } = payload.new
            applyCell(x, y, color, owner)
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

  return { offscreenRef, ready, applyCell, clearCell, sample, ownerAt, cellsOf }
}
