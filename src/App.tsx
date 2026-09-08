import { lazy, Suspense, useEffect, useState } from 'react';
import type { LayerCatalog } from '../shared/types.ts';
import { api } from './lib/api.ts';
import { NavRail, type View } from './components/NavRail.tsx';
import { Overview } from './views/Overview.tsx';
import { Coverage } from './views/Coverage.tsx';

// Recharts is only needed for the forecast band, and it is most of the bundle.
// Everything else draws in hand-rolled SVG, so it should not be paid for on
// the overview.
const ForecastView = lazy(() =>
  import('./views/Forecast.tsx').then((m) => ({ default: m.ForecastView })),
);

function currentView(): View {
  const hash = window.location.hash.replace('#/', '');
  return hash === 'forecast' || hash === 'coverage' ? hash : 'overview';
}

export function App() {
  const [view, setView] = useState<View>(currentView);
  const [catalog, setCatalog] = useState<LayerCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.layer().then(setCatalog).catch((e) => setError((e as Error).message));
    const onHash = () => setView(currentView());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (next: View) => {
    window.location.hash = `#/${next}`;
    setView(next);
  };

  return (
    <div style={{ minHeight: '100%', padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <NavRail view={view} onChange={go} catalog={catalog} />
      <main style={{ flex: 1, minWidth: 0 }}>
        <h1 className="sr-only">Logistics analytics dashboard</h1>
        {error && (
          <div className="card" style={{ padding: 12, marginBottom: 10, background: 'var(--amber-tint)', color: 'var(--amber-text)', fontSize: 12 }}>
            {error}
          </div>
        )}
        {view === 'overview' && <Overview catalog={catalog} />}
        {view === 'forecast' && (
          <Suspense fallback={<p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading the forecast view…</p>}>
            <ForecastView catalog={catalog} />
          </Suspense>
        )}
        {view === 'coverage' && <Coverage />}
      </main>
    </div>
  );
}
