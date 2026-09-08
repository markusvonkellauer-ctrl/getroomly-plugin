/**
 * Shared partner-availability state, readable/writable across the React
 * tree (App.tsx) and the plain-JS shadow-entry.tsx global API — the two
 * don't share a module scope any other way, since shadow-entry.tsx sets up
 * `window.GetRoomly` outside of React.
 *
 * Optimistic default (true), matching App.tsx's own default: a host page
 * calling `window.GetRoomly.isAvailable()` before the plugin has run its
 * first check should see "available" rather than a false negative.
 */
const STORAGE_PREFIX = 'getroomly:availability:';

/**
 * Smooths the trigger button's visible flash on repeat visits: without
 * this, every single page load starts from the optimistic "available"
 * default and only corrects itself once the network check resolves —
 * visibly flashing the button before hiding it, every time, for a
 * suspended partner. Persisting the last known result lets a returning
 * visitor's very first render already start from the right answer.
 *
 * Read/write failures (private browsing, storage disabled/full) are
 * swallowed — persistence is a nice-to-have that only smooths repeat
 * visits, never something correctness should depend on.
 */
function readPersistedAvailability(key: string): boolean | undefined {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (raw === 'true') {
      return true;
    }
    if (raw === 'false') {
      return false;
    }
  } catch {
    // Treat exactly like "nothing cached yet".
  }
  return undefined;
}

function writePersistedAvailability(key: string, available: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, String(available));
  } catch {
    // Ignore — the in-memory value is unaffected either way.
  }
}

let cachedResult: { key: string | undefined; available: boolean } = {
  key: undefined,
  available: true,
};

/**
 * Updates the cached value read by getAvailability() / GetRoomly.open().
 * Call from a useLayoutEffect, not during render — a plain variable write
 * is still an external mutation, and a render that gets interrupted or
 * discarded under React 18 concurrent rendering could otherwise still have
 * run it. useLayoutEffect only fires for renders that actually commit, and
 * runs synchronously right after commit (before paint), which keeps the
 * staleness window as small as it can safely be — effectively closing the
 * gap where GetRoomly.open() could read a value from a previous render.
 *
 * Split from notifyAvailabilityChanged() below on purpose: that one *is* a
 * side effect (dispatchEvent) that doesn't need to block paint, and
 * belongs in a regular effect instead. This function itself runs
 * unconditionally on every call — it's the caller's effect dependency
 * array (e.g. `[partnerAvailable]` in App.tsx) that limits how often it's
 * actually invoked.
 *
 * Keyed by apiKey, mirroring App.tsx's own `availabilityResult` cache: a
 * host page that swaps window.GetRoomlyEmbedConfig.apiKey (e.g. switching
 * to a different partner/product) must never have GetRoomly.open() read a
 * stale `false` computed for the previous key — see getAvailability() below.
 *
 * Also persists to localStorage (see readPersistedAvailability above) so a
 * returning visitor's next page load can start from this result instead of
 * the optimistic default.
 */
export function setAvailabilityValue(key: string | undefined, available: boolean): void {
  cachedResult = { key, available };
  if (key) {
    writePersistedAvailability(key, available);
  }
}

/**
 * Dispatches 'getroomly-availability-changed' so host pages can react
 * without polling — e.g. hiding their own custom trigger button (built
 * instead of the plugin's default EmbedButton, via `hideButton: true`)
 * once a partner is confirmed suspended for quota. Call from an effect,
 * not during render (unlike setAvailabilityValue above).
 */
export function notifyAvailabilityChanged(available: boolean): void {
  window.dispatchEvent(
    new CustomEvent('getroomly-availability-changed', { detail: { available } })
  );
}

/**
 * A cached result only applies to the apiKey it was computed for. Without
 * this check, GetRoomly.open() could stay permanently blocked after a host
 * page switches to a different (perfectly available) partner: the cache
 * would still hold the old partner's `false`, and open() would refuse to
 * even dispatch 'getroomly-open-modal' — the only thing that would let
 * App.tsx notice the new apiKey and re-check it.
 *
 * When this page load hasn't itself computed a result for the current key
 * yet (e.g. the very first call, before App.tsx's check has resolved),
 * falls back to a value persisted from an earlier visit rather than
 * jumping straight to the optimistic default — this is what lets a
 * returning visitor's first render already show the right answer. Only
 * once neither is available does it fall back to optimistic (true),
 * matching App.tsx's own fallback and checkPartnerAvailability itself
 * failing open.
 */
export function getAvailability(): boolean {
  const currentKey = window.GetRoomlyEmbedConfig?.apiKey;
  if (cachedResult.key === currentKey) {
    return cachedResult.available;
  }
  if (currentKey) {
    const persisted = readPersistedAvailability(currentKey);
    if (persisted !== undefined) {
      return persisted;
    }
  }
  return true;
}
