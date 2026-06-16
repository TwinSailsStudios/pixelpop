export const GRID = 30000 // 30000 x 30000 cells (sparse — only filled cells stored)

// Sentinel meaning "empty cell" — voids aren't stored, they're simply absent
// from the sparse map so the themed board background shows through.
export const VOID_COLOR = '#0a0a0b'

// Visible board background per theme (matches --c-void in index.css).
export const BOARD_BG = { dark: '#0a0a0b', light: '#f4f4f5' }

// The area *outside* the board bounds (the "border" surrounding the grid),
// kept distinct from the board so you can see where the board ends.
export const BORDER_BG = { dark: '#1b1b21', light: '#d6d6db' }

// Zoom limits (canvas pixels per grid cell)
export const MIN_SCALE = 0.02 // zoom right out to see the whole 30k board
export const MAX_SCALE = 40
export const DEFAULT_SCALE = 1

export const DISCORD_URL =
  import.meta.env.VITE_DISCORD_URL || 'https://discord.gg/'

export const DEFAULT_PALETTE = [
  '#ffffff', '#000000', '#ff4d4d', '#ffb000', '#ffe600',
  '#00ff9c', '#00b3ff', '#7a5cff', '#ff5cf0', '#8a8a8a',
]
