import { useEffect, useRef, type RefObject } from 'react';

export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps Tab/Shift+Tab inside `containerRef` while `isActive` is true, moves
 * focus into it on activation, restores whatever had focus before on
 * deactivation, and calls `onEscape` on the Escape key -- the standard
 * WAI-ARIA dialog behaviour the plugin's modal (`role="dialog"` in App.tsx)
 * already claims but never actually implemented, so a keyboard/screen-reader
 * user tabbing through it fell straight through into the host page behind
 * it instead of staying inside the widget.
 *
 * Implemented as a manual `document`-level keydown listener rather than
 * hiding the host page's own content (e.g. aria-hidden/inert on siblings):
 * the widget renders inside a Shadow DOM, so the host page's DOM is outside
 * our reach entirely -- this only needs to control where focus goes when it
 * would otherwise leave the container, which works regardless of what's
 * outside it.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement>,
  isActive: boolean,
  onEscape: () => void
) {
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Capture + restore focus -- deliberately keyed ONLY on `isActive`, not on
  // every render, so an unrelated parent re-render (e.g. App's availability
  // check resolving) can't yank focus away from something the user is
  // actively interacting with inside the dialog.
  useEffect(() => {
    if (!isActive) {
      return;
    }
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    containerRef.current?.focus();

    return () => {
      const previous = previouslyFocusedRef.current;
      if (previous && document.contains(previous)) {
        previous.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
  }, [isActive]);

  // Tab-trap + Escape -- safe to resubscribe more freely than the effect
  // above, since attaching a listener has no visible side effect of its own.
  useEffect(() => {
    if (!isActive) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscape();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }

      const container = containerRef.current;
      if (!container) {
        return;
      }
      // Recomputed on every Tab press, not cached -- the dialog's focusable
      // set changes as it moves through steps (upload -> processing ->
      // result), and this must always reflect what's on screen right now.
      // display:none filtered explicitly (e.g. the upload step's own
      // hidden <input type="file">) -- real browsers already skip these
      // from the native Tab order, so the trap must too, or its computed
      // first/last would disagree with where Tab actually lands.
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter(el => getComputedStyle(el).display !== 'none');
      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isActive, containerRef, onEscape]);
}
