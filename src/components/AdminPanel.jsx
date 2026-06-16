import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { STAMPS, tint, bounds } from '../lib/stamps'

const TOKEN_KEY = 'pixelpop_admin_token'

function Section({ title, children }) {
  return (
    <section className="rounded border border-edge bg-panel p-4">
      <h2 className="mb-3 text-xs tracking-widest text-accent">{title}</h2>
      {children}
    </section>
  )
}

const inputCls =
  'rounded border border-edge bg-void px-2 py-1.5 text-xs text-ink outline-none focus:border-accent'
const btnCls =
  'rounded border border-edge px-3 py-1.5 text-xs tracking-wider text-muted hover:border-accent hover:text-accent disabled:opacity-40'
const dangerBtn =
  'rounded border border-danger/60 px-3 py-1.5 text-xs tracking-wider text-danger hover:bg-danger/10'

// --- gate ------------------------------------------------------------------
function Gate({ onUnlock }) {
  const [token, setToken] = useState(import.meta.env.VITE_ADMIN_TOKEN || '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setErr('')
    const { data, error } = await supabase.rpc('admin_check', { p_token: token })
    setBusy(false)
    if (error) return setErr('network error')
    if (data?.ok) onUnlock(token)
    else setErr('invalid token')
  }

  return (
    <div className="flex h-screen items-center justify-center bg-void">
      <div className="w-80 rounded border border-edge bg-panel p-6">
        <h1 className="mb-1 text-sm tracking-[0.3em] text-accent">GOD MODE</h1>
        <p className="mb-4 text-[10px] text-muted">
          token validated server-side · never stored in the bundle
        </p>
        <input
          type="password"
          autoFocus
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="admin token"
          className={inputCls + ' w-full'}
        />
        {err && <p className="mt-2 text-xs text-danger">{err}</p>}
        <button onClick={submit} disabled={busy} className={btnCls + ' mt-4 w-full'}>
          {busy ? 'CHECKING…' : 'UNLOCK'}
        </button>
        <Link to="/" className="mt-4 block text-center text-[10px] text-muted hover:text-ink">
          ← back to board
        </Link>
      </div>
    </div>
  )
}

// --- stamp preview ---------------------------------------------------------
function StampPreview({ cells, scale = 6 }) {
  const { w, h } = bounds(cells)
  return (
    <svg width={w * scale} height={h * scale} className="border border-edge bg-void">
      {cells.map((c, i) => (
        <rect key={i} x={c.dx * scale} y={c.dy * scale} width={scale} height={scale} fill={c.color} />
      ))}
    </svg>
  )
}

// --- dashboard -------------------------------------------------------------
function Dashboard({ token, onLock }) {
  const [msg, setMsg] = useState('')
  const [logs, setLogs] = useState([])
  const [reported, setReported] = useState([])

  // audit wipe
  const [wipeUuid, setWipeUuid] = useState('')
  const [wipeReason, setWipeReason] = useState('')
  // force wipe
  const [area, setArea] = useState({ x1: '', y1: '', x2: '', y2: '', reason: '' })
  // stamp
  const [stampKey, setStampKey] = useState('heart')
  const [origin, setOrigin] = useState({ x: 500, y: 500 })
  const [override, setOverride] = useState('')

  const refresh = useCallback(async () => {
    const [{ data: l }, { data: r }] = await Promise.all([
      supabase.rpc('admin_recent_logs', { p_token: token, p_limit: 30 }),
      supabase.rpc('admin_top_reported', { p_token: token, p_limit: 20 }),
    ])
    setLogs(l || [])
    setReported(r || [])
  }, [token])

  useEffect(() => {
    refresh()
  }, [refresh])

  const run = async (label, promise) => {
    const { data, error } = await promise
    if (error) return setMsg(`${label}: network error`)
    if (data?.ok === false) return setMsg(`${label}: ${data.error}`)
    setMsg(`${label}: ok ${JSON.stringify(data)}`)
    refresh()
  }

  const doAuditWipe = () => {
    if (!wipeReason.trim()) return setMsg('audit_wipe: reason required')
    run(
      'audit_wipe',
      supabase.rpc('admin_audit_wipe', {
        p_token: token,
        p_target: wipeUuid.trim(),
        p_reason: wipeReason.trim(),
      })
    )
  }

  const doForceWipe = () =>
    run(
      'force_wipe',
      supabase.rpc('admin_force_wipe', {
        p_token: token,
        p_x1: Number(area.x1),
        p_y1: Number(area.y1),
        p_x2: Number(area.x2),
        p_y2: Number(area.y2),
        p_reason: area.reason,
      })
    )

  const doStamp = () => {
    let cells = STAMPS[stampKey].cells
    if (/^#[0-9a-fA-F]{6}$/.test(override)) cells = tint(cells, override)
    run(
      'stamp',
      supabase.rpc('admin_stamp', {
        p_token: token,
        p_ox: Number(origin.x),
        p_oy: Number(origin.y),
        p_pattern: cells,
        p_owner: null,
        p_reason: `stamp:${stampKey}`,
      })
    )
  }

  const activeCells = (() => {
    const c = STAMPS[stampKey].cells
    return /^#[0-9a-fA-F]{6}$/.test(override) ? tint(c, override) : c
  })()

  return (
    <div className="min-h-screen bg-void p-4 text-ink">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-sm tracking-[0.3em] text-accent">PIXELPOP // GOD MODE</h1>
        <div className="flex items-center gap-3 text-xs">
          <Link to="/" className="text-muted hover:text-ink">← board</Link>
          <button onClick={onLock} className={btnCls}>LOCK</button>
        </div>
      </header>

      {msg && (
        <div className="mb-4 break-all rounded border border-edge bg-panel px-3 py-2 text-[11px] text-accent">
          {msg}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="AUDIT WIPE — clear one user (reason required)">
          <div className="flex flex-col gap-2">
            <input
              value={wipeUuid}
              onChange={(e) => setWipeUuid(e.target.value)}
              placeholder="target UUID"
              className={inputCls}
            />
            <input
              value={wipeReason}
              onChange={(e) => setWipeReason(e.target.value)}
              placeholder="reason (logged to admin_audit_logs)"
              className={inputCls}
            />
            <button onClick={doAuditWipe} className={dangerBtn}>WIPE USER</button>
          </div>
        </Section>

        <Section title="FORCE-WIPE — clear a rectangular area">
          <div className="grid grid-cols-2 gap-2">
            {['x1', 'y1', 'x2', 'y2'].map((k) => (
              <input
                key={k}
                value={area[k]}
                onChange={(e) => setArea((a) => ({ ...a, [k]: e.target.value }))}
                placeholder={k}
                className={inputCls}
              />
            ))}
          </div>
          <input
            value={area.reason}
            onChange={(e) => setArea((a) => ({ ...a, reason: e.target.value }))}
            placeholder="reason (optional)"
            className={inputCls + ' mt-2 w-full'}
          />
          <button onClick={doForceWipe} className={dangerBtn + ' mt-2'}>WIPE AREA</button>
        </Section>

        <Section title="STAMP TOOL — seed a pattern onto the map">
          <div className="flex gap-4">
            <div className="flex flex-col gap-2">
              <select
                value={stampKey}
                onChange={(e) => setStampKey(e.target.value)}
                className={inputCls}
              >
                {Object.entries(STAMPS).map(([k, v]) => (
                  <option key={k} value={k}>{v.name}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <input
                  value={origin.x}
                  onChange={(e) => setOrigin((o) => ({ ...o, x: e.target.value }))}
                  placeholder="origin x"
                  className={inputCls + ' w-20'}
                />
                <input
                  value={origin.y}
                  onChange={(e) => setOrigin((o) => ({ ...o, y: e.target.value }))}
                  placeholder="origin y"
                  className={inputCls + ' w-20'}
                />
              </div>
              <input
                value={override}
                onChange={(e) => setOverride(e.target.value)}
                placeholder="#color override (optional)"
                className={inputCls}
              />
              <button onClick={doStamp} className={btnCls}>INJECT STAMP</button>
            </div>
            <div className="flex items-center justify-center">
              <StampPreview cells={activeCells} />
            </div>
          </div>
        </Section>

        <Section title="TOP REPORTED — quick wipe targets">
          <ul className="space-y-1 text-[11px]">
            {reported.length === 0 && <li className="text-muted">none</li>}
            {reported.map((r) => (
              <li key={r.reported_uuid} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  <span className="text-danger">{r.reports}×</span> {r.display_name}{' '}
                  <span className="text-muted">{r.reported_uuid?.slice(0, 8)}</span>
                </span>
                <button
                  onClick={() => {
                    setWipeUuid(r.reported_uuid)
                    setWipeReason(`reported ${r.reports}x`)
                  }}
                  className={btnCls}
                >
                  load
                </button>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="RECENT AUDIT LOG">
        <ul className="space-y-1 font-mono text-[10px] text-muted">
          {logs.length === 0 && <li>empty</li>}
          {logs.map((l) => (
            <li key={l.id} className="flex flex-wrap gap-2">
              <span className="text-accent">{l.action}</span>
              <span>{new Date(l.created_at).toLocaleString()}</span>
              {l.target_uuid && <span>{l.target_uuid.slice(0, 8)}</span>}
              {l.reason && <span className="text-ink">“{l.reason}”</span>}
              <span>{JSON.stringify(l.details)}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

export default function AdminPanel() {
  const [token, setToken] = useState(
    () => sessionStorage.getItem(TOKEN_KEY) || ''
  )

  const unlock = (t) => {
    sessionStorage.setItem(TOKEN_KEY, t)
    setToken(t)
  }
  const lock = () => {
    sessionStorage.removeItem(TOKEN_KEY)
    setToken('')
  }

  if (!token) return <Gate onUnlock={unlock} />
  return <Dashboard token={token} onLock={lock} />
}
