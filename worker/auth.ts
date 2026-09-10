/**
 * A signed session cookie behind a login form.
 *
 * The earlier version used HTTP Basic auth. It gated correctly but the only
 * interface it can offer is the browser's own credential dialog — no login
 * page, no sign out, and nothing an app can style or explain. This is the
 * smallest thing that is an actual login: a form, a signed cookie, and a way
 * out.
 *
 * The signature is an HMAC keyed with AUTH_PASSWORD, so a cookie cannot be
 * forged without it and rotating the password invalidates every session at
 * once. There is no server-side session store, which means sessions cannot be
 * revoked individually — acceptable for one shared credential, and the thing
 * that changes when real per-user auth replaces this.
 */
const COOKIE = 'scout_session';
const TTL_SECONDS = 12 * 60 * 60;

const encoder = new TextEncoder();

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(payload: string, secret: string): Promise<string> {
  return base64url(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(payload)));
}

export async function createSession(user: string, secret: string): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payload = `${user}.${expires}`;
  return `${payload}.${await sign(payload, secret)}`;
}

export async function isValidSession(token: string | null, secret: string): Promise<boolean> {
  if (!token) return false;
  const at = token.lastIndexOf('.');
  if (at < 0) return false;
  const payload = token.slice(0, at);
  const signature = token.slice(at + 1);

  // Verify before trusting anything in the payload, including the expiry.
  const expected = await sign(payload, secret);
  if (!timingSafeEqual(signature, expected)) return false;

  const expires = Number(payload.slice(payload.lastIndexOf('.') + 1));
  return Number.isFinite(expires) && expires > Math.floor(Date.now() / 1000);
}

export function readCookie(request: Request): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean): string {
  // HttpOnly so script cannot read it, SameSite=Lax so it is not sent on
  // cross-site POSTs, Secure whenever the connection can carry it.
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TTL_SECONDS}` +
    (secure ? '; Secure' : '');
}

export function clearedCookie(secure: boolean): string {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` + (secure ? '; Secure' : '');
}

/** Compares without returning early on the first differing character. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
