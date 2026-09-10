import { useState } from 'react';

/**
 * The sign-in screen.
 *
 * It is a page in the app rather than the browser's Basic-auth dialog, which
 * cannot be styled, cannot explain what it is guarding, and offers no way to
 * sign out afterwards.
 */
export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user, password }),
      });
      if (response.ok) {
        onSignedIn();
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? 'Sign in failed.');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <form onSubmit={submit} className="card"
            style={{ width: '100%', maxWidth: 380, padding: 26, display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 19, height: 19, background: 'var(--brand)', borderRadius: 5 }} />
          <h1 style={{ fontSize: 'var(--text-lg)', fontWeight: 500 }}>Space Scout</h1>
        </div>

        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Logistics analytics over 400 mock orders. Sign in to continue.
        </p>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>Username</span>
          <input value={user} onChange={(e) => setUser(e.target.value)}
                 autoComplete="username" autoFocus required className="focusable" style={field} />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                 autoComplete="current-password" required className="focusable" style={field} />
        </label>

        {error && (
          <p role="alert" style={{ fontSize: 'var(--text-sm)', color: 'var(--amber-text)',
                                   background: 'var(--amber-tint)', padding: '9px 11px', borderRadius: 8 }}>
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} className="focusable"
                style={{ fontSize: 'var(--text-md)', fontWeight: 500, padding: '10px 16px',
                         borderRadius: 'var(--radius-pill)', border: 'none', cursor: busy ? 'wait' : 'pointer',
                         background: 'var(--brand-soft)', color: 'var(--text-primary)' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

const field: React.CSSProperties = {
  fontSize: 'var(--text-md)', padding: '9px 12px', borderRadius: 8,
  border: '0.5px solid var(--border-strong)', background: 'var(--surface-card)',
  color: 'var(--text-primary)', width: '100%',
};
