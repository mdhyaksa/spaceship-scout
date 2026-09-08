import { useState } from 'react';
import type { LayerCatalog } from '../../shared/types.ts';
import type { Filter } from '../../shared/ir.ts';

const PERIODS = [
  { id: 'all', label: 'All 2025' },
  { id: 'last_3_months', label: 'Last 3 months' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_month', label: 'This month' },
];

/** Dimensions worth a chip: low-cardinality and filterable. */
const CHIP_DIMENSIONS = ['carrier', 'region', 'product_category', 'warehouse', 'order_status', 'is_promo'];

export function FilterBar({
  catalog, filters, period, onChange,
}: {
  catalog: LayerCatalog | null;
  filters: Filter[];
  period: string;
  onChange: (next: { filters: Filter[]; period: string }) => void;
}) {
  const [openChip, setOpenChip] = useState<string | null>(null);
  if (!catalog) return null;

  const dimensions = CHIP_DIMENSIONS
    .map((name) => catalog.dimensions.find((d) => d.name === name))
    .filter((d): d is NonNullable<typeof d> => Boolean(d));

  const selected = (name: string) => filters.find((f) => f.field === name)?.value ?? [];

  const toggle = (name: string, value: string) => {
    const current = selected(name);
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    const rest = filters.filter((f) => f.field !== name);
    onChange({ period, filters: next.length ? [...rest, { field: name, op: 'in', value: next }] : rest });
  };

  const activeCount = filters.length + (period !== 'all' ? 1 : 0);

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
      <select value={period} onChange={(e) => onChange({ filters, period: e.target.value })}
              className="focusable" aria-label="Period"
              style={{ ...chipStyle, color: period === 'all' ? 'var(--text-primary)' : 'var(--green-text)',
                       background: period === 'all' ? 'var(--surface-card)' : 'var(--green-tint)' }}>
        {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>

      {dimensions.map((dim) => {
        const values = dim.values ?? [];
        const chosen = selected(dim.name);
        const open = openChip === dim.name;
        return (
          <div key={dim.name} style={{ position: 'relative' }}>
            <button onClick={() => setOpenChip(open ? null : dim.name)} className="focusable"
                    style={{ ...chipStyle, cursor: 'pointer',
                             background: chosen.length ? 'var(--green-tint)' : 'var(--surface-card)',
                             color: chosen.length ? 'var(--green-text)' : 'var(--text-secondary)' }}>
              {dim.label}{chosen.length ? ` · ${chosen.length}` : ''}
            </button>
            {open && (
              <div className="card" style={{ position: 'absolute', top: '110%', left: 0, zIndex: 30, padding: 6,
                                             minWidth: 168, maxHeight: 240, overflowY: 'auto',
                                             boxShadow: '0 6px 18px rgba(20,20,20,0.10)' }}>
                {values.map((v) => (
                  <label key={v} style={{ display: 'flex', gap: 7, alignItems: 'center', padding: '4px 6px',
                                          fontSize: 12, cursor: 'pointer', borderRadius: 5 }}>
                    <input type="checkbox" checked={chosen.includes(v)} onChange={() => toggle(dim.name, v)} />
                    {dim.name === 'is_promo' ? (v === '1' ? 'Promotional' : 'Standard') : v}
                  </label>
                ))}
                {values.length === 0 && (
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', padding: 6 }}>
                    {dim.approx_cardinality} values — filter from the chat instead.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {activeCount > 0 && (
        <button onClick={() => onChange({ filters: [], period: 'all' })} className="focusable"
                style={{ ...chipStyle, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
          Clear
        </button>
      )}

      <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }} className="tnum">
        Data through {catalog.data_as_of} · layer {catalog.version}
      </span>
    </div>
  );
}

const chipStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '4px 10px',
  border: '0.5px solid var(--border-strong)',
  borderRadius: 'var(--radius-pill)',
  background: 'var(--surface-card)',
  appearance: 'none',
};
