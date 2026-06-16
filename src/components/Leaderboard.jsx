import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

function Board({ title, rows, valueKey }) {
  return (
    <div className="flex-1">
      <h3 className="mb-2 border-b border-edge pb-1 text-[10px] tracking-widest text-muted">
        {title}
      </h3>
      <ol className="space-y-1 text-xs">
        {rows.length === 0 && <li className="text-muted">—</li>}
        {rows.map((r, i) => (
          <li key={r.id} className="flex items-center justify-between gap-2">
            <span className="truncate text-ink">
              <span className="text-muted">{i + 1}.</span> {r.display_name}
            </span>
            <span className="text-accent">{r[valueKey]}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export default function Leaderboard() {
  const [placed, setPlaced] = useState([])
  const [destroyed, setDestroyed] = useState([])

  const load = useCallback(async () => {
    const [{ data: p }, { data: d }] = await Promise.all([
      supabase.from('leaderboard_placed').select('*'),
      supabase.from('leaderboard_destroyed').select('*'),
    ])
    setPlaced(p || [])
    setDestroyed(d || [])
  }, [])

  useEffect(() => {
    load()
    // Refresh on any profile change + a slow poll as a safety net.
    const channel = supabase
      .channel('leaderboard')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        () => load()
      )
      .subscribe()
    const t = setInterval(load, 15000)
    return () => {
      supabase.removeChannel(channel)
      clearInterval(t)
    }
  }, [load])

  return (
    <aside className="flex w-full flex-col gap-4 border-l border-edge bg-panel/60 p-3 md:w-60">
      <Board title="MOST PLACED" rows={placed} valueKey="pixels_placed" />
      <Board title="MOST DESTROYED" rows={destroyed} valueKey="pixels_destroyed" />
    </aside>
  )
}
