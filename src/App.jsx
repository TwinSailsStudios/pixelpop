import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import PixelCanvas from './components/PixelCanvas'
import Toolbar from './components/Toolbar'
import Leaderboard from './components/Leaderboard'
import DiscordCTA from './components/DiscordCTA'
import NameModal from './components/NameModal'
import { useUser } from './hooks/useUser'
import { useTheme } from './hooks/useTheme'
import { BOARD_BG } from './lib/constants'

const RECENT_KEY = 'pixelpop_recent_colors'

export default function App() {
  const { uuid, profile, setDisplayName } = useUser()
  const { theme, toggle } = useTheme()
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

  const onResult = useCallback((data) => {
    if (!data) return setStatus('network error')
    if (data.ok === false) return setStatus(data.error)
    if (data.already) return setStatus('you already reported this user')
    if (data.info) return setStatus(data.info)
    if (typeof data.reports === 'number') return setStatus(`reported (${data.reports} total)`)
    if (data.removed != null) return setStatus(`destroyed ${data.removed} pixel(s)`)
    if (data.count != null) return setStatus(`placed ${data.count} pixel(s)`)
    return setStatus('placed')
  }, [])

  const onColorPick = useCallback(
    (c) => {
      setColor(c)
      pushRecent(c)
      setTool('place')
      setStatus(`picked ${c}`)
    },
    [pushRecent]
  )

  useEffect(() => {
    if (color) pushRecent(color)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color])

  const controls = (
    <>
      <NameModal current={profile?.display_name} onSave={setDisplayName} />
      <button
        onClick={toggle}
        title="Toggle light / dark"
        className="rounded border border-edge px-2 py-1.5 text-xs text-muted hover:border-accent hover:text-accent"
      >
        {theme === 'dark' ? '☀ LIGHT' : '☾ DARK'}
      </button>
      <DiscordCTA />
      <Link to="/admin" className="text-[10px] text-muted hover:text-ink">
        admin
      </Link>
    </>
  )

  return (
    <div className="flex h-screen flex-col">
      <Toolbar
        tool={tool}
        setTool={setTool}
        color={color}
        setColor={setColor}
        recent={recent}
        controls={controls}
      />

      {/* board takes the rest of the screen */}
      <div className="flex min-h-0 flex-1">
        <main className="relative min-h-0 flex-1">
          <PixelCanvas
            uuid={uuid}
            tool={tool}
            color={color}
            boardBg={BOARD_BG[theme] || BOARD_BG.dark}
            onColorPick={onColorPick}
            onResult={onResult}
          />
          <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded bg-void/70 px-2 py-1 text-[10px] text-muted">
            {status || 'scroll/buttons to zoom · drag to pan · hover a pixel to see its owner'}
          </div>
        </main>
        <Leaderboard />
      </div>
    </div>
  )
}
