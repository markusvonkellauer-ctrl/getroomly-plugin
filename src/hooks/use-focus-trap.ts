import { useEffect, useRef, type RefObject } from 'react';

export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Nested overlays (e.g. the Terms-of-Use dialog rendered on top of the main
// upload/result modal) each get their own useFocusTrap call -- this module-
// level stack tracks which one is topmost, so only IT acts on Tab/Escape
// while any deeper trap stays registered but dormant. Plain array, not a
// Set: order (who's on top) is exactly what matters here, and trap
// activations/deactivations are always few and shallow (2-3 levels at most).
const activeTrapStack: HTMLElement[] = [];

function isTopmostTrap(container: HTMLElement | null): boolean {
  return !!container && activeTrapStack[activeTrapStack.length - 1] === container;
}

// document.activeElement stops at the shadow host when focus is actually on
// a descendant inside a ShadowRoot (the plugin always renders inside one --
// see shadow-entry.tsx) -- comparing THAT against `first`/`last` never
// matches in production, so the trap silently never engages there even
// though every test using plain document.activeElement passes (RTL renders
// App directly, without the real shadow boundary). getRootNode() returns
// the ShadowRoot the container actually lives in (or `document` itself,
// outside a shadow tree), so reading .activeElement off THAT is correct
// for focus that's actually inside our own shadow tree.
//
// Falls back to document.activeElement when the root's own activeElement
// is null: that happens legitimately when the dialog was opened
// programmatically from the HOST page's own trigger (window.GetRoomly.open(),
// not the plugin's default EmbedButton) -- that trigger lives in the host's
// light DOM, outside our shadow root entirely, so shadowRoot.activeElement
// correctly reports nothing focused *inside the shadow tree*, but
// document.activeElement still correctly names it. Only matters for the
// capture-on-open call site below; while the trap is actively engaged
// (Tab-boundary checks), focus is always inside the shadow tree by
// construction, so the fallback is a no-op there.
function getActiveElement(container: HTMLElement): Element | null {
  const root = container.getRootNode() as Document | ShadowRoot;
  return root.activeElement ?? document.activeElement;
}

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
 *
 * Nesting-safe: call this again for a dialog rendered ON TOP of another
 * (e.g. the Terms-of-Use overlay on top of the main modal) -- the stack
 * above ensures only the topmost one actually reacts, so Tab/Escape can't
 * leak into (or wrap into) a covered dialog underneath.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement>,
  isActive: boolean,
  onEscape: () => void
) {
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Capture + restore focus, and stack registration -- deliberately keyed
  // ONLY on `isActive`, not on every render, so an unrelated parent
  // re-render (e.g. App's availability check resolving) can't yank focus
  // away from something the user is actively interacting with inside the
  // dialog.
  useEffect(() => {
    if (!isActive) {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }

    // Same Shadow DOM problem as the Tab-boundary check below: plain
    // document.activeElement is the <getroomly-plugin> shadow HOST while
    // focus is actually on a descendant inside it (e.g. the trigger button
    // that opened this dialog), not the trigger itself -- capturing THAT
    // means the later restore calls .focus() on the non-useful host
    // element instead of returning focus to the real trigger.
    const activeBeforeOpen = getActiveElement(container);
    previouslyFocusedRef.current =
      activeBeforeOpen instanceof HTMLElement ? activeBeforeOpen : null;
    container.focus();
    activeTrapStack.push(container);

    return () => {
      const idx = activeTrapStack.indexOf(container);
      if (idx !== -1) {
        activeTrapStack.splice(idx, 1);
      }
      const previous = previouslyFocusedRef.current;
      // .isConnected, not document.contains(previous) -- contains() does
      // NOT cross shadow boundaries (a shadow root's children aren't
      // reachable via regular parentNode traversal from document), so it
      // returns false for a still-very-much-connected trigger button
      // inside the plugin's shadow tree, silently skipping the restore.
      if (previous && previous.isConnected) {
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
      const container = containerRef.current;
      // Only the topmost trap on the stack acts -- e.g. while the Terms
      // dialog is open on top of the main modal, the main modal's own trap
      // must do nothing at all, or Tab/Escape would act on (or wrap into)
      // content that's covered and no longer the active surface.
      if (!isTopmostTrap(container)) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        onEscape();
        return;
      }
      if (event.key !== 'Tab' || !container) {
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
      const active = getActiveElement(container);

      // Found in review: when the currently-focused control is unmounted
      // out from under the trap (e.g. selecting a file swaps the upload
      // step's controls for the processing step's), the browser moves
      // focus to the shadow host/body -- neither `first`, `last`, nor
      // `container`. Treating "active element isn't even inside container
      // anymore" as its own out-of-bounds case (re-entering at `first` on
      // Tab, `last` on Shift+Tab) covers that alongside the two named
      // boundaries, instead of only the moment right after opening (the
      // `active === container` case, still needed on its own: activation
      // focuses the container itself, not `first`, so a Shift+Tab pressed
      // immediately would otherwise match neither and escape).
      const outsideContainer = !(active instanceof Node) || !container.contains(active);
      if (event.shiftKey && (active === first || active === container || outsideContainer)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outsideContainer)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isActive, containerRef, onEscape]);
}
