import { useCallback, useEffect, useState } from 'react'

const KEY = 'pixelpop_theme'

/** Light/dark toggle persisted in localStorage and applied to <html>. */
export function useTheme() {
  const [theme, setTheme] = useState(
    () => localStorage.getItem(KEY) || 'dark'
  )

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.classList.toggle('light', theme === 'light')
    root.style.colorScheme = theme
    localStorage.setItem(KEY, theme)
  }, [theme])

  const toggle = useCallback(
    () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    []
  )

  return { theme, toggle }
}
