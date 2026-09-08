import type { LayerCatalog } from '../../shared/types.ts';

export type View = 'overview' | 'forecast' | 'coverage';

const ITEMS: { id: View | string; label: string; enabled: boolean; hint?: string }[] = [
  { id: 'overview', label: 'Overview', enabled: true },
  { id: 'forecast', label: 'Forecast', enabled: true },
  { id: 'coverage', label: 'Coverage', enabled: true },
  { id: 'carriers', label: 'Carriers', enabled: false, hint: 'Use the Breakdown tile — its dimension switcher covers carriers.' },
  { id: 'lanes', label: 'Lanes', enabled: false, hint: 'Use the Breakdown tile — its dimension switcher covers lanes.' },
  { id: 'clients', label: 'Clients', enabled: false, hint: 'Use the Breakdown tile — its dimension switcher covers clients.' },
];

export function NavRail({ view, onChange, catalog }: {
  view: View; onChange: (v: View) => void; catalog: LayerCatalog | null;
}) {
  return (
    <nav style={{ width: 132, flex: 'none', background: 'var(--surface-rail)', borderRadius: 10,
                  padding: '12px 9px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '0 0 14px', padding: '0 3px' }}>
        <span style={{ width: 14, height: 14, background: 'var(--brand)', borderRadius: 3, display: 'inline-block' }} />
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-on-rail)' }}>Manifest</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {ITEMS.map((item) => {
          const active = item.enabled && view === item.id;
          return (
            <button key={item.id} className="focusable"
                    disabled={!item.enabled}
                    title={item.hint}
                    onClick={() => item.enabled && onChange(item.id as View)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 6,
                      border: 'none', textAlign: 'left', width: '100%',
                      background: active ? 'rgba(255,255,255,0.10)' : 'transparent',
                      color: !item.enabled ? '#6E6E74' : active ? 'var(--text-on-rail)' : 'var(--text-rail-dim)',
                      cursor: item.enabled ? 'pointer' : 'not-allowed',
                      fontSize: 11, fontWeight: active ? 500 : 400,
                    }}>
              {item.label}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 'auto', borderTop: '0.5px solid rgba(255,255,255,0.13)', paddingTop: 9 }}>
        <p style={{ fontSize: 10, color: '#6E6E74', lineHeight: 1.5 }} className="tnum">
          Data through<br />{catalog?.data_as_of ?? '—'}
        </p>
        <p style={{ fontSize: 9, color: '#5A5A60', lineHeight: 1.5, marginTop: 6 }}>
          Relative dates resolve against the data, not today.
        </p>
      </div>
    </nav>
  );
}
