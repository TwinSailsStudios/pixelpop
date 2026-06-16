export const GRID = 1000 // 1000 x 1000 cells

// Sentinel meaning "empty cell" — voids aren't stored as a color, they're
// erased to transparent in the offscreen buffer so the themed board background
// shows through (see usePixels / PixelCanvas).
export const VOID_COLOR = '#0a0a0b'

// Visible board background per theme (matches --c-void in index.css).
export const BOARD_BG = { dark: '#0a0a0b', light: '#f4f4f5' }

// Zoom limits (canvas pixels per grid cell)
export const MIN_SCALE = 0.4
export const MAX_SCALE = 40
export const DEFAULT_SCALE = 8

// Level thresholds — must mirror pp_level_for() in the SQL migration.
export const LEVELS = [
  { level: 1, threshold: 0, rate: 1 },
  { level: 2, threshold: 100, rate: 2 },
  { level: 3, threshold: 500, rate: 3 },
  { level: 4, threshold: 1500, rate: 4 },
  { level: 5, threshold: 5000, rate: 5 },
]

export const DISCORD_URL =
  import.meta.env.VITE_DISCORD_URL || 'https://discord.gg/'

export const DEFAULT_PALETTE = [
  '#ffffff', '#000000', '#ff4d4d', '#ffb000', '#ffe600',
  '#00ff9c', '#00b3ff', '#7a5cff', '#ff5cf0', '#8a8a8a',
]
