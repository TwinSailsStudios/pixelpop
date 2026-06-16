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
// Don't try to back-fill the whole 30k board at once: above this many visible
// tiles (i.e. zoomed far out) we rely on realtime + already-loaded tiles only.
const MAX_REGION_TILES = 80

export function usePixels(onChange) {
  const tilesRef = useRef(new Map())
  const cellsByOwnerRef = useRef(new Map())
  const loadedTilesRef = useRef(new Set())
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

  // Lazily back-fill the tiles overlapping a viewport bbox (each fetched once).
  // Realtime keeps everything current after that, so we only pay for the
  // historical state of regions the user actually looks at.
  const ensureRegion = useCallback(
    async (minX, minY, maxX, maxY) => {
      const tx0 = minX >> 8, tx1 = maxX >> 8
      const ty0 = minY >> 8, ty1 = maxY >> 8
      if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > MAX_REGION_TILES) return

      const loaded = loadedTilesRef.current
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity
      let any = false
      for (let tx = tx0; tx <= tx1; tx++) {
        for (let ty = ty0; ty <= ty1; ty++) {
          const k = tx + ',' + ty
          if (loaded.has(k)) continue
          loaded.add(k)
          any = true
          bx0 = Math.min(bx0, tx * TILE)
          by0 = Math.min(by0, ty * TILE)
          bx1 = Math.max(bx1, tx * TILE + TILE - 1)
          by1 = Math.max(by1, ty * TILE + TILE - 1)
        }
      }
      if (!any) return

      let from = 0
      const page = 1000
      let total = 0
      for (;;) {
        const { data, error } = await supabase
          .from('pixels')
          .select('x,y,color,owner')
          .gte('x', bx0).lte('x', bx1)
          .gte('y', by0).lte('y', by1)
          .range(from, from + page - 1)
        if (error || !data) break
        for (const p of data) applyCell(p.x, p.y, p.color, p.owner)
        total += data.length
        if (data.length < page || total > 100000) break
        from += page
      }
      onChange?.()
    },
    [applyCell, onChange]
  )

  useEffect(() => {
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
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setReady(true)
      })

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { ready, applyCell, clearCell, sample, ownerAt, cellsOf, forEachIn, ensureRegion }
}
