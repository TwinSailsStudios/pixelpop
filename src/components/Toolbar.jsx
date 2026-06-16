import { DEFAULT_PALETTE } from '../lib/constants'

const TOOLS = [
  { id: 'place', label: 'PLACE', hint: 'place 1 pixel' },
  { id: 'line', label: 'LINE', hint: 'click start, then end' },
  { id: 'square', label: 'SQUARE', hint: 'click two corners' },
  { id: 'destroy', label: 'DESTROY', hint: 'erase a pixel' },
  { id: 'eyedropper', label: 'PICK', hint: 'sample color' },
  { id: 'report', label: 'REPORT', hint: 'flag a user (once)' },
]

export default function Toolbar({ tool, setTool, color, setColor, recent, controls }) {
  return (
    <div className="flex flex-col flex-wrap gap-3 border-b border-edge bg-panel/80 px-3 py-2 backdrop-blur md:flex-row md:items-center md:justify-between">
      {/* tools */}
      <div className="flex flex-wrap gap-2">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            title={t.hint}
            className={`rounded border px-3 py-1.5 text-xs tracking-wider transition ${
              tool === t.id
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-edge text-muted hover:border-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* color */}
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted">
          <span>COLOR</span>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-8 w-10 cursor-pointer rounded border border-edge bg-transparent"
          />
        </label>
        <div className="flex gap-1">
          {DEFAULT_PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              style={{ background: c }}
              className="h-6 w-6 rounded border border-edge"
              title={c}
            />
          ))}
        </div>
        {recent.length > 0 && (
          <div className="flex items-center gap-1 border-l border-edge pl-3">
            <span className="text-[10px] text-muted">RECENT</span>
            {recent.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{ background: c }}
                className="h-5 w-5 rounded border border-edge"
                title={c}
              />
            ))}
          </div>
        )}
      </div>

      {/* right-side controls (name, theme, discord, admin) */}
      {controls && <div className="flex items-center gap-3">{controls}</div>}
    </div>
  )
}
