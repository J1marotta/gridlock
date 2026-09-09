import { TUNE_DEFAULTS, TUNE_META, getByPath } from './tune.js'

const CATEGORIES = [
  ['race', '🏁 RACE'],
  ['car', '🚗 CAR'],
  ['tires', '🛞 TIRES'],
  ['items', '🎁 ITEMS'],
  ['traffic', '🚐 TRAFFIC'],
  ['pit', '🔧 PIT'],
]

function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flatten(v, prefix ? `${prefix}.${k}` : k) : [prefix ? `${prefix}.${k}` : k],
  )
}

// The `~` panel: every tunable, live.
export default function AdminPanel({ tune, onPatch, canEdit, open, onClose }) {
  if (!open) return null
  return (
    <div className="admin-overlay" onClick={onClose}>
      <div className="admin-panel" onClick={e => e.stopPropagation()}>
        <div className="admin-head">
          <span>🔧 LIVE TUNE {!canEdit && '(spectating — host only)'}</span>
          <button className="nitro-btn" onClick={onClose}>~ CLOSE</button>
        </div>
        {!canEdit && <p className="admin-note">Only the host can tune a live multiplayer race. Start a solo race to tweak freely.</p>}
        {CATEGORIES.map(([cat, title]) => (
          <div key={cat} className="admin-cat">
            <h4>{title}</h4>
            {Object.keys(TUNE_META).filter(p => p.startsWith(`${cat}.`)).map(path => {
              const meta = TUNE_META[path]
              const value = getByPath(tune, path)
              const disabled = !canEdit
              return (
                <label key={path} className="admin-row">
                  <span className="admin-label">{meta.label}</span>
                  {meta.type === 'bool' ? (
                    <input
                      type="checkbox" checked={Boolean(value)} disabled={disabled}
                      onChange={e => onPatch({ [path]: e.target.checked })}
                    />
                  ) : meta.type === 'select' ? (
                    <select
                      value={value} disabled={disabled}
                      onChange={e => onPatch({ [path]: Number(e.target.value) })}
                    >
                      {meta.options.map(o => <option key={o} value={o}>{o === 0 ? 'off' : o}</option>)}
                    </select>
                  ) : (
                    <>
                      <input
                        type="range" min={meta.min} max={meta.max} step={meta.step}
                        value={value} disabled={disabled}
                        onChange={e => onPatch({ [path]: Number(e.target.value) })}
                      />
                      <span className="admin-val">{value}</span>
                    </>
                  )}
                </label>
              )
            })}
          </div>
        ))}
        <div className="nitro-row">
          <button
            className="nitro-btn" disabled={!canEdit}
            onClick={() => {
              const patch = {}
              for (const path of flatten(TUNE_DEFAULTS)) patch[path] = getByPath(TUNE_DEFAULTS, path)
              onPatch(patch)
            }}
          >RESET ALL</button>
        </div>
      </div>
    </div>
  )
}
