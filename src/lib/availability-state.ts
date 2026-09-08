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
let currentAvailability = true;

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
 */
export function setAvailabilityValue(available: boolean): void {
  currentAvailability = available;
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

export function getAvailability(): boolean {
  return currentAvailability;
}
