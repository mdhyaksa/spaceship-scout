/**
 * Tile cache.
 *
 * Key = metric + dimension + filters + data_as_of + layer_version, exactly as
 * SPEC.md section 6.6 defines it, so a layer commit or a data reload
 * invalidates everything without an explicit purge. Refresh busts one tile's
 * key, not the whole dashboard.
 *
 * An in-isolate Map rather than the Workers Cache API, which is a no-op on
 * workers.dev subdomains and would silently do nothing in a preview deploy.
 * At 400 rows the database is a millisecond away, so this exists to make the
 * refresh semantics real rather than to save time.
 */
const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 200;

interface Entry<T> { value: T; expires: number }

const store = new Map<string, Entry<unknown>>();

export function cacheKey(parts: (string | number | null | undefined)[]): string {
  return parts.map((p) => (p === null || p === undefined ? '' : String(p))).join('|');
}

export function cacheGet<T>(key: string): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    store.delete(key);
    return null;
  }
  return hit.value as T;
}

export function cacheSet<T>(key: string, value: T): void {
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }
  store.set(key, { value, expires: Date.now() + TTL_MS });
}

export function cacheBust(key: string): void {
  store.delete(key);
}
