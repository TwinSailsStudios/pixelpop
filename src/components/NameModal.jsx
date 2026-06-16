import { useState } from 'react'

export default function NameModal({ current, onSave }) {
  const [name, setName] = useState(current || '')
  const [saving, setSaving] = useState(false)

  return (
    <div className="flex items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Anonymous"
        maxLength={24}
        className="w-36 rounded border border-edge bg-void px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
      />
      <button
        disabled={saving}
        onClick={async () => {
          setSaving(true)
          await onSave(name)
          setSaving(false)
        }}
        className="rounded border border-edge px-2 py-1.5 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-50"
      >
        SET NAME
      </button>
    </div>
  )
}
