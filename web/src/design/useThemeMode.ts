import { useEffect, useState } from 'react'
import { THEME_STORAGE_KEY, type ThemeMode } from './tokens'

function readStoredTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    if (raw === 'sunlight' || raw === 'ops') return raw
  } catch {
    /* ignore */
  }
  return 'ops'
}

export function useThemeMode(): {
  theme: ThemeMode
  setTheme: (t: ThemeMode) => void
  toggleTheme: () => void
} {
  const [theme, setThemeState] = useState<ThemeMode>(() =>
    typeof window !== 'undefined' ? readStoredTheme() : 'ops',
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.classList.toggle('theme-sunlight', theme === 'sunlight')
    document.documentElement.classList.toggle('theme-ops', theme === 'ops')
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', theme === 'sunlight' ? '#f4f6f8' : '#0e1116')
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  function setTheme(t: ThemeMode) {
    setThemeState(t)
  }

  function toggleTheme() {
    setThemeState((t) => (t === 'ops' ? 'sunlight' : 'ops'))
  }

  return { theme, setTheme, toggleTheme }
}
