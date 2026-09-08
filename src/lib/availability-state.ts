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
 *
 * Unlike availabilityByKey below, entries here accumulate across page
 * loads with no eviction — deliberately not addressed: a given embed
 * normally uses one stable partner apiKey for its whole lifetime, so
 * distinct-key churn (and therefore entry count) isn't expected to grow
 * meaningfully. Bounding this properly would need a secondary
 * recency-tracking structure (localStorage has no built-in access order),
 * which isn't proportionate to a risk this unlikely to materialize.
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

// Per-key, not a single overwritable slot: a host page that cycles between
// multiple apiKeys during one page load (e.g. browsing between products
// backed by different partners) must not lose an already-confirmed result
// for a key just because a different key was looked up in between. A
// single-slot cache would forget key A's confirmed `false` the moment key
// B is looked up, and — if localStorage persistence for A had failed for
// any reason (private browsing, storage disabled) — GetRoomly.open() could
// then incorrectly report a suspended partner as available again the next
// time the host switches back to A.
//
// Bounded to guard against unbounded growth if a host page churns through
// many distinct apiKeys in one session (unlikely in practice — a given
// embed normally uses one stable partner key — but cheap to guard
// regardless). Only ever written by confirmed results (see
// setAvailabilityValue) — getAvailability() itself never writes here (see
// its own comment below), so recency is purely "last confirmed", not
// diluted by read frequency — a real LRU rather than an approximation.
// Map preserves insertion order, so evicting the first key once over the
// cap is correct without a separate timestamp/bookkeeping structure —
// remember() re-inserts an existing key to move it to the "most recently
// used" end first.
const MAX_TRACKED_KEYS = 20;
const availabilityByKey = new Map<string, boolean>();

function remember(key: string, available: boolean): void {
  availabilityByKey.delete(key);
  availabilityByKey.set(key, available);
  if (availabilityByKey.size > MAX_TRACKED_KEYS) {
    const oldestKey = availabilityByKey.keys().next().value;
    if (oldestKey !== undefined) {
      availabilityByKey.delete(oldestKey);
    }
  }
}

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
 * Also persists to localStorage (see writePersistedAvailability above) so a
 * returning visitor's next page load can start from this result instead of
 * the optimistic default.
 */
export function setAvailabilityValue(key: string | undefined, available: boolean): void {
  if (key) {
    remember(key, available);
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
 *
 * Deliberately a pure read — no memoization of the persisted/optimistic
 * fallback here (only setAvailabilityValue's confirmed results go through
 * remember()). That keeps this function free of any mutation, which is
 * what lets App.tsx call it directly during render (see partnerAvailable
 * below) instead of needing an effect to publish into React state first —
 * calling a function with a side effect during render would risk running
 * that effect for a render React ends up discarding, under React 18
 * concurrent rendering. localStorage.getItem is cheap enough that reading
 * it on every call, instead of caching the result, isn't a real concern.
 */
export function getAvailability(): boolean {
  const currentKey = window.GetRoomlyEmbedConfig?.apiKey;
  if (!currentKey) {
    return true;
  }
  const known = availabilityByKey.get(currentKey);
  if (known !== undefined) {
    return known;
  }
  return readPersistedAvailability(currentKey) ?? true;
}

/**
 * Test-only: clears every in-memory confirmed/memoized result (not
 * localStorage). Exists because availabilityByKey is module-level state
 * that persists for as long as this module stays loaded — a test file
 * that imports App (or this module) once via a static top-level `import`,
 * rather than calling jest.resetModules() per test, would otherwise leak
 * one test's confirmed result into the next test using the same apiKey.
 *
 * jest.resetModules() + re-requiring App per test (avoiding the need for
 * this export at all) was tried and reverted: it also resets React,
 * react-dom, and @testing-library/react to fresh module instances, and a
 * freshly-required App.tsx then calls hooks against a *different* React
 * copy than the one @testing-library/react's render() is using — React
 * requires a single instance to resolve its internal hook dispatcher,
 * so every hook call in App.tsx failed with "Invalid hook call" the
 * moment resetModules() was introduced. Isolating only this module
 * without dragging React along would need re-requiring App.tsx as well
 * (it's what pulls availability-state.ts in), which is the same problem.
 */
export function __resetAvailabilityStateForTests(): void {
  availabilityByKey.clear();
}
