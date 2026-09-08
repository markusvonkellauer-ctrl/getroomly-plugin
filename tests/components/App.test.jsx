/**
 * App Component Tests — partner-availability-gated trigger button
 */

import { render, screen, waitFor, act } from '@testing-library/react';
import App from '../../src/App';

jest.mock('../../src/services/partner-status', () => ({
  checkPartnerAvailability: jest.fn(),
}));

import { checkPartnerAvailability } from '../../src/services/partner-status';

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
