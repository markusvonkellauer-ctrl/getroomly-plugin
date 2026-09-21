/**
 * App Component Tests — partner-availability-gated trigger button
 */

import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import App from '../../src/App';

jest.mock('../../src/services/partner-status', () => ({
  checkPartnerAvailability: jest.fn(),
}));

import { checkPartnerAvailability } from '../../src/services/partner-status';
import { __resetAvailabilityStateForTests } from '../../src/lib/availability-state';
import { FOCUSABLE_SELECTOR } from '../../src/hooks/use-focus-trap';

const baseEmbedConfig = {
  apiKey: 'grm_pub_test',
  productImage: 'https://example.com/product.jpg',
  sku: 'rug-001',
  productName: 'Test Rug',
  category: 'Carpet',
  measurements: { width: 200, depth: 300, height: 1 },
};

/**
 * Waits for the specific promise checkPartnerAvailability's last call
 * returned to settle, then flushes React's resulting state update/effects
 * via act(). Deterministic for any resolved value — including `true`,
 * which a naive "wait for the availability-changed event" approach can't
 * detect reliably: `true` is also the optimistic default set at mount, so
 * a check that resolves to `true` again produces no actual value change
 * and the event never re-fires. Not just "called" either — that's true
 * synchronously on mount, before the mocked promise has resolved at all.
 */
async function waitForAvailability() {
  await waitFor(() => expect(checkPartnerAvailability).toHaveBeenCalled());
  const { results } = checkPartnerAvailability.mock;
  await act(async () => {
    await results[results.length - 1].value;
  });
}

describe('App — trigger button visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // App.tsx now seeds its initial availability state from getAvailability()
    // (see availability-state.ts), which persists to localStorage — without
    // clearing it, an earlier test resolving to `false` for the same apiKey
    // would leak into a later test expecting the optimistic default.
    localStorage.clear();
    // availability-state.ts's in-memory availabilityByKey map is
    // module-level state that this file's static `import App` keeps alive
    // across every test — this file never calls jest.resetModules().
    // Without resetting it here too, a leftover confirmed value from an
    // earlier test's own mount (App.tsx publishes via setAvailabilityValue
    // once its check confirms a result) would outrank the localStorage
    // seed a test sets up, since in-memory takes priority.
    __resetAvailabilityStateForTests();
    window.GetRoomlyEmbedConfig = { ...baseEmbedConfig };
  });

  afterEach(() => {
    delete window.GetRoomlyEmbedConfig;
  });

  it('shows the trigger button immediately (optimistic default) before the check resolves', () => {
    // Never-resolving promise keeps the check pending so we can assert the
    // optimistic default — a check that errors out must never wrongly hide
    // a working button, and neither should one that's merely still pending.
    checkPartnerAvailability.mockReturnValueOnce(new Promise(() => {}));

    render(<App />);

    expect(screen.getByRole('button', { name: /visualize in your room/i })).toBeInTheDocument();
  });

  it('hides the trigger button immediately, before the check resolves, when a suspended result was persisted from an earlier visit', () => {
    // The whole point of the localStorage cache in availability-state.ts:
    // a returning visitor's very first render should already reflect the
    // real answer instead of flashing the optimistic default every time.
    localStorage.setItem('getroomly:availability:grm_pub_test', 'false');
    checkPartnerAvailability.mockReturnValueOnce(new Promise(() => {}));

    render(<App />);

    expect(
      screen.queryByRole('button', { name: /visualize in your room/i })
    ).not.toBeInTheDocument();
  });

  it('does not persist the optimistic/seeded value to localStorage before the check has confirmed a result', async () => {
    // Regression coverage for a Copilot review finding on PR #84: publishing
    // (and therefore persisting, via setAvailabilityValue) on every commit —
    // including the seeded/optimistic starting guess, not just a confirmed
    // result — could permanently "poison" localStorage with an unconfirmed
    // value if the user navigates away before the real check resolves.
    let resolveCheck;
    checkPartnerAvailability.mockReturnValueOnce(
      new Promise(resolve => {
        resolveCheck = resolve;
      })
    );

    render(<App />);

    // Still pending — nothing confirmed yet, nothing should be persisted.
    expect(localStorage.getItem('getroomly:availability:grm_pub_test')).toBeNull();

    await act(async () => {
      resolveCheck(false);
      await Promise.resolve();
    });

    // Now confirmed — the real result gets persisted.
    expect(localStorage.getItem('getroomly:availability:grm_pub_test')).toBe('false');
  });

  it('shows the trigger button once the partner is confirmed available', async () => {
    checkPartnerAvailability.mockResolvedValueOnce(true);

    render(<App />);

    await waitFor(() => {
      expect(checkPartnerAvailability).toHaveBeenCalledWith('grm_pub_test');
    });
    expect(screen.getByRole('button', { name: /visualize in your room/i })).toBeInTheDocument();
  });

  it('hides the trigger button once the partner is reported unavailable (quota exceeded)', async () => {
    checkPartnerAvailability.mockResolvedValueOnce(false);

    render(<App />);

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /visualize in your room/i })
      ).not.toBeInTheDocument();
    });
  });

  it('resets to the optimistic default when apiKey changes, instead of keeping a stale unavailable result', async () => {
    checkPartnerAvailability.mockResolvedValueOnce(false);

    render(<App />);

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /visualize in your room/i })
      ).not.toBeInTheDocument();
    });

    // Host page swaps in a different partner key and re-opens — a fresh,
    // never-resolving check for the new key, so we can assert the button is
    // shown again immediately rather than staying hidden from the old key's
    // stale `false` result.
    checkPartnerAvailability.mockReturnValueOnce(new Promise(() => {}));
    window.GetRoomlyEmbedConfig = { ...baseEmbedConfig, apiKey: 'grm_pub_different' };
    act(() => {
      window.dispatchEvent(new CustomEvent('getroomly-open-modal'));
    });

    await waitFor(() => {
      expect(checkPartnerAvailability).toHaveBeenCalledWith('grm_pub_different');
    });
    expect(screen.getByRole('button', { name: /visualize in your room/i })).toBeInTheDocument();
  });

  it('shows the correct (not optimistic) state immediately when switching to a key already confirmed unavailable in an earlier visit', async () => {
    // Regression coverage for a Copilot review finding on PR #84: switching
    // apiKey while mounted used to fall back to the optimistic default
    // until the fresh check for the new key resolved, even if a persisted
    // result for that key already existed — reintroducing exactly the
    // flash the localStorage cache exists to avoid, just for the
    // apiKey-change path instead of the initial-mount path.
    checkPartnerAvailability.mockResolvedValueOnce(true);

    render(<App />);
    await waitForAvailability();
    expect(screen.getByRole('button', { name: /visualize in your room/i })).toBeInTheDocument();

    // A different partner, already confirmed unavailable in an earlier
    // page load — persisted, but not yet (re-)checked this page load.
    localStorage.setItem('getroomly:availability:grm_pub_other', 'false');
    checkPartnerAvailability.mockReturnValueOnce(new Promise(() => {}));
    window.GetRoomlyEmbedConfig = { ...baseEmbedConfig, apiKey: 'grm_pub_other' };

    act(() => {
      window.dispatchEvent(new CustomEvent('getroomly-open-modal'));
    });

    // Hidden immediately — not optimistically shown while the fresh check
    // for this key is still pending.
    expect(
      screen.queryByRole('button', { name: /visualize in your room/i })
    ).not.toBeInTheDocument();
  });

  it('dispatches getroomly-modal-opened when opened via the default EmbedButton (not just via events)', async () => {
    checkPartnerAvailability.mockResolvedValueOnce(true);
    const openedHandler = jest.fn();
    window.addEventListener('getroomly-modal-opened', openedHandler);

    try {
      render(<App />);
      await waitForAvailability();

      act(() => {
        screen.getByRole('button', { name: /visualize in your room/i }).click();
      });

      expect(openedHandler).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('getroomly-modal-opened', openedHandler);
    }
  });

  it('the loading state sets no inline fontFamily, so it can inherit a brand override', () => {
    // Found in review: an inline fontFamily here always beat brand.ts's
    // font-family:inherit override (inline styles win over any injected
    // <style> rule), and defaultLanguage is only ever 'en'/'sv' -- both
    // Latin-script -- so there was never a real non-Latin-glyph-coverage
    // reason to keep it. Invalid config (missing required fields beyond
    // apiKey) keeps isReady false, so this renders the loading branch.
    window.GetRoomlyEmbedConfig = { apiKey: 'grm_pub_test' };

    const { container } = render(<App />);

    const loadingText = screen.getByText(/loading configuration/i);
    // The loading branch's own root div (its immediate parent) is what
    // used to carry the inline override -- not container itself, which is
    // React Testing Library's own outer wrapper.
    expect(loadingText.parentElement.style.fontFamily).toBe('');
    expect(container).toBeTruthy(); // sanity: something actually rendered
  });

  it('the "Configuration Error" state sets no inline fontFamily, so it can inherit a brand override', async () => {
    // Reached when a previously-valid config becomes invalid on a re-check
    // (e.g. the host page swaps in bad data and re-opens) -- isReady stays
    // true from the earlier successful load, config stays the last valid
    // object, but error is freshly set, which is what actually renders
    // App.tsx's dedicated error screen (not the generic loading one).
    checkPartnerAvailability.mockResolvedValueOnce(true);
    render(<App />);
    await waitForAvailability();

    window.GetRoomlyEmbedConfig = { apiKey: 'grm_pub_test' };
    act(() => {
      window.dispatchEvent(new CustomEvent('getroomly-open-modal'));
    });

    const errorHeading = screen.getByText(/GetRoomly Configuration Error/i);
    expect(errorHeading.parentElement.style.fontFamily).toBe('');
  });

  it('the modal container uses the brand radius token, so branded pages can flatten its shell too', async () => {
    checkPartnerAvailability.mockResolvedValueOnce(true);
    render(<App />);
    await waitForAvailability();

    act(() => {
      screen.getByRole('button', { name: /visualize in your room/i }).click();
    });

    expect(screen.getByRole('dialog').style.borderRadius).toBe('var(--getroomly-radius-modal)');
  });

  it('still respects config.hideButton regardless of availability', async () => {
    checkPartnerAvailability.mockResolvedValueOnce(true);
    window.GetRoomlyEmbedConfig = { ...baseEmbedConfig, hideButton: true };

    render(<App />);

    await waitFor(() => {
      expect(checkPartnerAvailability).toHaveBeenCalled();
    });
    expect(
      screen.queryByRole('button', { name: /visualize in your room/i })
    ).not.toBeInTheDocument();
  });
});

describe('App — getroomly-open-modal safety net', () => {
  // Covers the case a host page built its own trigger button (hideButton:
  // true) instead of using the default EmbedButton — window.GetRoomly.open()
  // dispatches this event, and the modal itself must refuse to open for a
  // suspended partner regardless of what triggered the event.
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    // availability-state.ts's in-memory availabilityByKey map is
    // module-level state that this file's static `import App` keeps alive
    // across every test — this file never calls jest.resetModules().
    // Without resetting it here too, a leftover confirmed value from an
    // earlier test's own mount (App.tsx publishes via setAvailabilityValue
    // once its check confirms a result) would outrank the localStorage
    // seed a test sets up, since in-memory takes priority.
    __resetAvailabilityStateForTests();
    window.GetRoomlyEmbedConfig = { ...baseEmbedConfig, hideButton: true };
  });

  afterEach(() => {
    delete window.GetRoomlyEmbedConfig;
  });

  it('does not open the modal on getroomly-open-modal when the partner is unavailable', async () => {
    checkPartnerAvailability.mockResolvedValueOnce(false);

    render(<App />);
    await waitForAvailability();

    act(() => {
      window.dispatchEvent(new CustomEvent('getroomly-open-modal'));
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the modal on getroomly-open-modal when the partner is available', async () => {
    checkPartnerAvailability.mockResolvedValueOnce(true);

    render(<App />);
    await waitForAvailability();

    act(() => {
      window.dispatchEvent(new CustomEvent('getroomly-open-modal'));
    });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // Regression coverage: shadow-entry.tsx's isModalOpen flag listens for
  // 'getroomly-modal-opened' rather than 'getroomly-open-modal', precisely
  // because the latter is only a *request* that App.tsx can refuse — an
  // earlier version of this fix dispatched (effectively) the request-level
  // event unconditionally and left isModalOpen wrongly true for a modal
  // that never actually opened.

  it('dispatches getroomly-modal-opened only when the modal actually opens', async () => {
    checkPartnerAvailability.mockResolvedValueOnce(true);
    const openedHandler = jest.fn();
    window.addEventListener('getroomly-modal-opened', openedHandler);

    try {
      render(<App />);
      await waitForAvailability();

      act(() => {
        window.dispatchEvent(new CustomEvent('getroomly-open-modal'));
      });

      expect(openedHandler).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('getroomly-modal-opened', openedHandler);
    }
  });

  it('does not dispatch getroomly-modal-opened when the open request is refused (unavailable)', async () => {
    checkPartnerAvailability.mockResolvedValueOnce(false);
    const openedHandler = jest.fn();
    window.addEventListener('getroomly-modal-opened', openedHandler);

    try {
      render(<App />);
      await waitForAvailability();

      act(() => {
        window.dispatchEvent(new CustomEvent('getroomly-open-modal'));
      });

      expect(openedHandler).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('getroomly-modal-opened', openedHandler);
    }
  });

  it('does not dispatch getroomly-modal-opened when config is invalid, even though getroomly-open-modal fires', () => {
    // Regression coverage for a Copilot review finding on PR #83: the
    // 'getroomly-open-modal' listener used to flip isModalOpen regardless of
    // whether the modal could actually render — reporting "opened" via the
    // centralized confirmation effect while the component was still showing
    // its error state instead. window.GetRoomlyEmbedConfig here is missing
    // every required field but apiKey, so useEmbedConfig never reaches
    // isReady, and configReadyRef must keep handleOpen from firing at all.
    window.GetRoomlyEmbedConfig = { apiKey: 'grm_pub_test' };
    const openedHandler = jest.fn();
    window.addEventListener('getroomly-modal-opened', openedHandler);

    try {
      render(<App />);

      act(() => {
        window.dispatchEvent(new CustomEvent('getroomly-open-modal'));
      });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(openedHandler).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('getroomly-modal-opened', openedHandler);
    }
  });

  // Regression coverage: shadow-entry.tsx's close() used to dispatch
  // 'getroomly-modal-closed' itself, in addition to App.tsx's centralized
  // isModalOpen effect also dispatching it once React actually closed —
  // double-firing the confirmation for every close() call.
  it('dispatches getroomly-modal-closed exactly once when closed via getroomly-close-modal', async () => {
    checkPartnerAvailability.mockResolvedValueOnce(true);
    const closedHandler = jest.fn();
    window.addEventListener('getroomly-modal-closed', closedHandler);

    try {
      render(<App />);
      await waitForAvailability();

      act(() => {
        window.dispatchEvent(new CustomEvent('getroomly-open-modal'));
      });
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      act(() => {
        window.dispatchEvent(new CustomEvent('getroomly-close-modal'));
      });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(closedHandler).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('getroomly-modal-closed', closedHandler);
    }
  });
});

describe('App — modal focus trap', () => {
  // The modal claims role="dialog", which per WAI-ARIA implies Tab/Shift+Tab
  // stay inside it, Escape closes it, and focus both enters it on open and
  // returns to whatever opened it on close -- found in review that none of
  // that was actually implemented, so a keyboard/screen-reader user tabbing
  // through the modal fell straight through into the host page behind it.
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    __resetAvailabilityStateForTests();
    window.GetRoomlyEmbedConfig = { ...baseEmbedConfig };
  });

  afterEach(() => {
    delete window.GetRoomlyEmbedConfig;
  });

  // Queries generically (not hardcoding "the close button is first, the
  // terms link is last") so this doesn't silently stop testing anything
  // real if the upload step's own content changes later.
  const getFocusable = dialog =>
    Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
      el => getComputedStyle(el).display !== 'none'
    );

  const openModal = async () => {
    checkPartnerAvailability.mockResolvedValueOnce(true);
    render(<App />);
    await waitForAvailability();

    const trigger = screen.getByRole('button', { name: /visualize in your room/i });
    // Simulates a keyboard user having reached the trigger button before
    // activating it -- real browsers vary on whether a mouse click alone
    // also moves focus, so this makes "focus returns to the trigger on
    // close" a deterministic thing to assert rather than an accident of
    // jsdom's click() behaviour.
    trigger.focus();
    act(() => {
      trigger.click();
    });

    return { trigger, dialog: screen.getByRole('dialog') };
  };

  it('moves focus into the dialog when it opens', async () => {
    const { dialog } = await openModal();
    expect(document.activeElement).toBe(dialog);
  });

  it('marks the dialog as modal and gives it an accessible name via the visible step heading', async () => {
    // Found in review: role="dialog" alone doesn't tell assistive tech this
    // is the only interactive surface (aria-modal) or give it a name
    // (aria-labelledby) -- without these a screen reader announces an
    // unnamed dialog and may still expose the covered page behind it.
    const { dialog } = await openModal();

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy)).toHaveTextContent('Upload Photo');
  });

  it('wraps Tab from the last focusable element back to the first, instead of escaping into the host page', async () => {
    const { dialog } = await openModal();
    const focusable = getFocusable(dialog);
    expect(focusable.length).toBeGreaterThan(1);
    const [first, last] = [focusable[0], focusable[focusable.length - 1]];

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });

    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from the first focusable element back to the last', async () => {
    const { dialog } = await openModal();
    const focusable = getFocusable(dialog);
    const [first, last] = [focusable[0], focusable[focusable.length - 1]];

    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(last);
  });

  it('also wraps Shift+Tab pressed immediately on open, before any descendant has been individually focused', async () => {
    // Found in review: activation focuses the dialog CONTAINER itself, not
    // `first` -- a Shift+Tab pressed at that exact moment matched neither
    // `first` nor `last` in the boundary check, so it fell through to the
    // browser's native (trap-escaping) backward navigation instead of
    // wrapping.
    const { dialog } = await openModal();
    expect(document.activeElement).toBe(dialog);
    const last = getFocusable(dialog).at(-1);

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(last);
  });

  it("does NOT intervene on a Tab press from the middle of the dialog's own focusable elements", async () => {
    // The trap should only intervene at the boundaries -- everywhere else,
    // the browser's own native Tab order (correct here, since it's all one
    // self-contained subtree) must be left alone. Asserts on the event's
    // own defaultPrevented state, not on document.activeElement staying put
    // -- jsdom's fireEvent never performs real Tab navigation regardless of
    // whether anything handles the event, so an activeElement assertion
    // alone would pass even if this were testing the (already-a-boundary)
    // first element instead of a genuine middle one.
    const { dialog } = await openModal();
    const focusable = getFocusable(dialog);
    expect(focusable.length).toBeGreaterThan(2);
    const middle = focusable[1];

    middle.focus();
    const notPrevented = fireEvent.keyDown(middle, { key: 'Tab' });

    expect(notPrevented).toBe(true);
  });

  it('closes the modal on Escape', async () => {
    const { dialog } = await openModal();

    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('restores focus to the trigger button after closing via Escape', async () => {
    const { dialog, trigger } = await openModal();
    // Moves focus away from trigger FIRST -- otherwise this couldn't tell
    // "focus was correctly restored" apart from "focus never left trigger
    // in the first place" (e.g. if the initial move-into-dialog behaviour
    // were broken), since both look identical at the assertion below.
    getFocusable(dialog)[0].focus();
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.keyDown(document.activeElement, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('restores focus to the trigger button after closing via the backdrop click', async () => {
    const { dialog, trigger } = await openModal();
    getFocusable(dialog)[0].focus();
    expect(document.activeElement).not.toBe(trigger);

    act(() => {
      document.querySelector('.fixed.inset-0.z-50').click();
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('while the Terms dialog opens on top of the main modal, Tab stays inside the Terms dialog only -- the outer modal trap defers to it', async () => {
    // Unlike room-visualization-flow.test.jsx's own nested-trap coverage
    // (which only proves the Terms dialog's own trap works in isolation,
    // since that file never renders App's outer trap at all), THIS is the
    // one place both traps are genuinely stacked at once -- the real
    // scenario the module-level activeTrapStack in use-focus-trap.ts exists
    // to handle.
    const { dialog } = await openModal();

    act(() => {
      screen.getByText('Terms of Use & Privacy').click();
    });

    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(2);
    const termsDialog = dialogs.find(d => d !== dialog);

    const focusable = getFocusable(termsDialog);
    expect(focusable.length).toBeGreaterThan(1);
    const last = focusable[focusable.length - 1];

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });

    // If the outer trap had also acted (no stack check), it would have
    // wrapped to ITS OWN first focusable element (the outer close button,
    // still present underneath, uncovered content), not stayed inside the
    // topmost Terms dialog.
    expect(termsDialog.contains(document.activeElement)).toBe(true);
  });
});
