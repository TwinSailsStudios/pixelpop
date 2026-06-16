// Predefined pixel stamps for the admin "traffic spoof" / seed tool.
// Each stamp compiles to [{ dx, dy, color }] relative to a placement origin.
// Built from ASCII templates so they're easy to read and edit.

function compile(rows, palette) {
  const out = []
  rows.forEach((row, dy) => {
    ;[...row].forEach((ch, dx) => {
      const color = palette[ch]
      if (color) out.push({ dx, dy, color })
    })
  })
  return out
}

const HEART_ROWS = [
  ' rr rr ',
  'rrrrrrr',
  'rrrrrrr',
  ' rrrrr ',
  '  rrr  ',
  '   r   ',
]

const INVADER_ROWS = [
  '  g   g  ',
  '   g g   ',
  '  ggggg  ',
  ' gg g gg ',
  'ggggggggg',
  'g ggggg g',
  'g g   g g',
  '   g g   ',
]

const SMILEY_ROWS = [
  ' yyyyy ',
  'yykyykk', // note: stylized
  'yyyyyyy',
  'ykyyyky',
  'yykkkyy',
  ' yyyyy ',
]

const STAR_ROWS = [
  '    w    ',
  '    w    ',
  'wwwwwwwww',
  ' wwwwwww ',
  '  wwwww  ',
  ' ww   ww ',
  'w       w',
]

export const STAMPS = {
  heart: { name: 'HEART', cells: compile(HEART_ROWS, { r: '#ff4d4d' }) },
  invader: { name: 'INVADER', cells: compile(INVADER_ROWS, { g: '#00ff9c' }) },
  smiley: {
    name: 'SMILEY',
    cells: compile(SMILEY_ROWS, { y: '#ffe600', k: '#000000' }),
  },
  star: { name: 'STAR', cells: compile(STAR_ROWS, { w: '#ffffff' }) },
}

/** Recolor a stamp's cells to a single override color. */
export function tint(cells, color) {
  return cells.map((c) => ({ ...c, color }))
}

/** Bounding box of a stamp (for preview sizing). */
export function bounds(cells) {
  const w = Math.max(...cells.map((c) => c.dx)) + 1
  const h = Math.max(...cells.map((c) => c.dy)) + 1
  return { w, h }
}
