import { useEffect, useState, useCallback } from 'react'
import PixelCanvas from './components/PixelCanvas'
import Toolbar from './components/Toolbar'
import Leaderboard from './components/Leaderboard'
import DiscordCTA from './components/DiscordCTA'
import NameModal from './components/NameModal'
import { useUser } from './hooks/useUser'

const RECENT_KEY = 'pixelpop_recent_colors'

export default function App() {
  const { uuid, profile, setProfile, setDisplayName } = useUser()
  const [tool, setTool] = useState('place')
  const [color, setColor] = useState('#00ff9c')
  const [recent, setRecent] = useState(
    () => JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
  )
  const [status, setStatus] = useState('')

  const pushRecent = useCallback((c) => {
    setRecent((prev) => {
      const next = [c, ...prev.filter((x) => x !== c)].slice(0, 8)
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  // Surface RPC results (cooldown, level-ups, reports) in the status bar and
  // keep the local economy readout in sync.
  const onResult = useCallback(
    (data) => {
      if (!data) return setStatus('network error')
      if (data.ok === false) {
        if (data.error === 'cooldown') setStatus('on cooldown — banking pixels…')
        else setStatus(data.error)
        return
      }
      if (data.info) return setStatus(data.info)
      if (typeof data.available === 'number') {
        setProfile((p) =>
          p
            ? {
                ...p,
                pixels_available: data.available,
                level: data.level ?? p.level,
                pixels_placed: data.pixels_placed ?? p.pixels_placed,
              }
            : p
        )
      }
      if (data.purged) setStatus('user purged (10+ reports)')
      else if (data.removed != null) setStatus(`destroyed ${data.removed} pixel(s)`)
      else setStatus('placed')
    },
    [setProfile]
  )

  const onColorPick = useCallback(
    (c) => {
      setColor(c)
      pushRecent(c)
      setTool('place')
      setStatus(`picked ${c}`)
    },
    [pushRecent]
  )

  // Track palette use for the "recent" row.
  useEffect(() => {
    if (color) pushRecent(color)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color])

  const level = profile?.level ?? 1
  const bank = profile?.pixels_available ?? 0

  return (
    <div className="flex h-screen flex-col">
      {/* header */}
      <header className="flex items-center justify-between gap-4 border-b border-edge bg-panel px-4 py-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-bold tracking-[0.3em] text-accent">
            PIXELPOP
          </h1>
          <span className="hidden text-[10px] text-muted sm:inline">
            // territory war
          </span>
        </div>
        <div className="flex items-center gap-3">
          <NameModal current={profile?.display_name} onSave={setDisplayName} />
          <DiscordCTA />
        </div>
      </header>

      <Toolbar
        tool={tool}
        setTool={setTool}
        color={color}
        setColor={setColor}
        recent={recent}
        bank={bank}
        level={level}
      />

      {/* main */}
      <div className="flex min-h-0 flex-1">
        <main className="relative min-h-0 flex-1">
          <PixelCanvas
            uuid={uuid}
            tool={tool}
            color={color}
            onColorPick={onColorPick}
            onResult={onResult}
          />
          <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-void/70 px-2 py-1 text-[10px] text-muted">
            {status || 'scroll to zoom · drag to pan · click to act'}
          </div>
        </main>
        <Leaderboard />
      </div>
    </div>
  )
}
