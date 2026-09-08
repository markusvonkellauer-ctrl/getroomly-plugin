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
 * Called by App.tsx whenever partnerAvailable changes. Updates the cached
 * value read by isAvailable()/GetRoomly.open(), and dispatches an event so
 * host pages can react without polling — e.g. hiding their own custom
 * trigger button (built instead of the plugin's default EmbedButton, via
 * `hideButton: true`) once a partner is confirmed suspended for quota.
 */
export function setAvailability(available: boolean): void {
  currentAvailability = available;
  window.dispatchEvent(
    new CustomEvent('getroomly-availability-changed', { detail: { available } })
  );
}

export function getAvailability(): boolean {
  return currentAvailability;
}
