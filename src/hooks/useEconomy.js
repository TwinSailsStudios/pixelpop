import { useEffect, useReducer, useRef, useCallback } from 'react'

/**
 * Client-side mirror of the server banking economy. The server is always
 * authoritative — every RPC result re-anchors this state — but between calls
 * we extrapolate the bank forward in real time so the UI can show a live
 * cooldown countdown and gate optimistic placement without a round-trip.
 *
 * bank(t) = min(rate, available_at_anchor + minutes_since_anchor * rate)
 */
export function useEconomy() {
  // Canonical state held in a ref so closures (canvas click handlers) always
  // read fresh values; a 4Hz tick forces re-render for the countdown.
  const s = useRef({ available: 0, anchor: Date.now(), rate: 1, level: 1 })
  const [, tick] = useReducer((n) => n + 1, 0)

  useEffect(() => {
    const t = setInterval(tick, 250)
    return () => clearInterval(t)
  }, [])

  const live = useCallback(() => {
    const { available, anchor, rate } = s.current
    const mins = (Date.now() - anchor) / 60000
    return Math.min(rate, available + mins * rate)
  }, [])

  const applyServer = useCallback(
    (data) => {
      if (!data) return
      if (typeof data.level === 'number') {
        s.current.level = data.level
        s.current.rate = Math.min(5, Math.max(1, data.level))
      }
      if (typeof data.available === 'number') {
        s.current.available = data.available
        s.current.anchor = Date.now()
      }
      tick()
    },
    []
  )

  const applyProfile = useCallback((p) => {
    if (!p) return
    s.current.level = p.level ?? 1
    s.current.rate = Math.min(5, Math.max(1, p.level ?? 1))
    s.current.available = Number(p.pixels_available ?? 0)
    // Server already accounts for elapsed time on its next refill, so anchor now.
    s.current.anchor = Date.now()
    tick()
  }, [])

  /** Spend n charges optimistically if available; re-anchor from the reduced
   *  balance so refill continues correctly. Returns false if insufficient. */
  const trySpend = useCallback(
    (n = 1) => {
      const cur = live()
      if (Math.floor(cur) < n) return false
      s.current.available = cur - n
      s.current.anchor = Date.now()
      tick()
      return true
    },
    [live]
  )

  /** Refund on a failed server call. */
  const refund = useCallback(
    (n = 1) => {
      s.current.available = Math.min(s.current.rate, live() + n)
      s.current.anchor = Date.now()
      tick()
    },
    [live]
  )

  const value = live()
  const floor = Math.floor(value)
  const { rate, level } = s.current
  const full = value >= rate - 1e-9
  // Seconds until the next whole charge lands.
  const secondsToNext = full ? 0 : Math.ceil(((floor + 1 - value) / rate) * 60)
  const fraction = full ? 1 : value - floor

  return {
    available: value,
    floor,
    rate,
    level,
    full,
    secondsToNext,
    fraction,
    applyServer,
    applyProfile,
    trySpend,
    refund,
  }
}
