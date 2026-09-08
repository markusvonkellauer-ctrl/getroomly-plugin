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
 * Updates the cached value read by getAvailability() / GetRoomly.open() —
 * a plain variable write, not a side effect, so it's safe to call
 * unconditionally during React's render phase (App.tsx does exactly that).
 * Doing so keeps this in sync with the current render's derived
 * `partnerAvailable` immediately, rather than one render-and-commit cycle
 * later via an effect — closing a real (if narrow) window where
 * GetRoomly.open() could read a stale value for a tick.
 *
 * Split from notifyAvailabilityChanged() below on purpose: that one *is* a
 * side effect (dispatchEvent) and belongs in an effect, deduped to fire
 * only on actual settled changes — not on every render pass, including
 * StrictMode's double-render in dev.
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
