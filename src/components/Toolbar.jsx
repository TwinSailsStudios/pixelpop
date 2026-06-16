import { DEFAULT_PALETTE } from '../lib/constants'

const TOOLS = [
  { id: 'place', label: 'PLACE', hint: '1 pixel' },
  { id: 'destroy', label: 'DESTROY', hint: '2 pixels' },
  { id: 'eyedropper', label: 'PICK', hint: 'sample color' },
  { id: 'report', label: 'REPORT', hint: 'flag abuse' },
]

export default function Toolbar({ tool, setTool, color, setColor, recent, econ, controls }) {
  const { floor, rate, level, full, secondsToNext, fraction } = econ
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

      {/* economy readout + live cooldown */}
      <div className="flex items-center gap-4 text-xs">
        <span className="text-muted">
          LVL <span className="text-accent">{level}</span>
        </span>
        <span className="text-muted">
          BANK <span className="text-accent">{floor}</span>/{rate}
        </span>
        <div className="flex w-28 flex-col gap-1">
          <span className="text-[10px] text-muted">
            {full ? 'BANK FULL' : `+1 in ${secondsToNext}s`}
          </span>
          <div className="h-1 w-full overflow-hidden rounded bg-edge">
            <div
              className="h-full bg-accent transition-[width] duration-200"
              style={{ width: `${Math.round((full ? 1 : fraction) * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* right-side controls (name, theme, discord, admin) */}
      {controls && (
        <div className="flex items-center gap-3">{controls}</div>
      )}
    </div>
  )
}
