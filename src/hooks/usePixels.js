import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { VOID_COLOR } from '../lib/constants'

const TILE = 256
const tileKey = (x, y) => (x >> 8) + ',' + (y >> 8) // 256-wide tiles
const cellKey = (x, y) => x + ',' + y

/**
 * Sparse, tiled board store — the only feasible model for a 30k x 30k grid
 * (900M cells). Filled cells live in `tiles`: tileKey -> Map(cellKey -> {c,o}).
 * The renderer asks for just the visible tiles via forEachIn, so cost scales
 * with what's on screen, not with the board size. `cellsByOwner` powers the
 * "highlight this user's pixels" hover feature.
 */
export function usePixels(onChange) {
  const tilesRef = useRef(new Map())
  const cellsByOwnerRef = useRef(new Map())
  const [ready, setReady] = useState(false)

  const indexOwner = (ck, oldOwner, newOwner) => {
    const by = cellsByOwnerRef.current
    if (oldOwner && oldOwner !== newOwner) by.get(oldOwner)?.delete(ck)
    if (newOwner) {
      let set = by.get(newOwner)
      if (!set) by.set(newOwner, (set = new Set()))
      set.add(ck)
    }
  }

  const clearCell = useCallback(
    (x, y) => {
      const tk = tileKey(x, y)
      const tile = tilesRef.current.get(tk)
      if (!tile) return
      const ck = cellKey(x, y)
      const prev = tile.get(ck)
      if (!prev) return
      tile.delete(ck)
      if (tile.size === 0) tilesRef.current.delete(tk)
      indexOwner(ck, prev.o, null)
      onChange?.()
    },
    [onChange]
  )

  const applyCell = useCallback(
    (x, y, color, owner) => {
      if (!color || color === VOID_COLOR) return clearCell(x, y)
      const tk = tileKey(x, y)
      let tile = tilesRef.current.get(tk)
      if (!tile) tilesRef.current.set(tk, (tile = new Map()))
      const ck = cellKey(x, y)
      const prev = tile.get(ck)
      tile.set(ck, { c: color, o: owner || null })
      indexOwner(ck, prev?.o, owner || null)
      onChange?.()
    },
    [onChange, clearCell]
  )

  const sample = useCallback((x, y) => {
    const tile = tilesRef.current.get(tileKey(x, y))
    return tile?.get(cellKey(x, y))?.c || VOID_COLOR
  }, [])

  const ownerAt = useCallback((x, y) => {
    const tile = tilesRef.current.get(tileKey(x, y))
    return tile?.get(cellKey(x, y))?.o || null
  }, [])

  const cellsOf = useCallback((owner) => cellsByOwnerRef.current.get(owner), [])

  // Visit every filled cell within a grid-space bounding box (visible tiles only).
  const forEachIn = useCallback((minX, minY, maxX, maxY, cb) => {
    const tx0 = minX >> 8, tx1 = maxX >> 8
    const ty0 = minY >> 8, ty1 = maxY >> 8
    const tiles = tilesRef.current
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        const tile = tiles.get(tx + ',' + ty)
        if (!tile) continue
        for (const [ck, v] of tile) {
          const i = ck.indexOf(',')
          const x = +ck.slice(0, i)
          const y = +ck.slice(i + 1)
          if (x >= minX && x <= maxX && y >= minY && y <= maxY) cb(x, y, v.c)
        }
      }
    }
  }, [])

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

  return { ready, applyCell, clearCell, sample, ownerAt, cellsOf, forEachIn }
}
