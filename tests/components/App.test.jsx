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

    // Waiting for checkPartnerAvailability to have been *called* isn't
    // enough — that happens synchronously on mount, before its promise
    // resolves. Wait for the availability-changed event carrying the
    // resolved `false` specifically, so the ref the open-modal listener
    // reads has actually been updated before we dispatch it.
    const availabilityHandler = jest.fn();
    window.addEventListener('getroomly-availability-changed', availabilityHandler);

    try {
      render(<App />);

      await waitFor(() => {
        expect(availabilityHandler).toHaveBeenCalledWith(
          expect.objectContaining({ detail: { available: false } })
        );
      });

      act(() => {
        window.dispatchEvent(new CustomEvent('getroomly-open-modal'));
      });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    } finally {
      window.removeEventListener('getroomly-availability-changed', availabilityHandler);
    }
  });

  it('opens the modal on getroomly-open-modal when the partner is available', async () => {
    checkPartnerAvailability.mockResolvedValueOnce(true);

    render(<App />);

    await waitFor(() => {
      expect(checkPartnerAvailability).toHaveBeenCalled();
    });

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
      await waitFor(() => expect(checkPartnerAvailability).toHaveBeenCalled());

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
    const availabilityHandler = jest.fn();
    window.addEventListener('getroomly-modal-opened', openedHandler);
    window.addEventListener('getroomly-availability-changed', availabilityHandler);

    try {
      render(<App />);
      await waitFor(() => {
        expect(availabilityHandler).toHaveBeenCalledWith(
          expect.objectContaining({ detail: { available: false } })
        );
      });

      act(() => {
        window.dispatchEvent(new CustomEvent('getroomly-open-modal'));
      });

      expect(openedHandler).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('getroomly-modal-opened', openedHandler);
      window.removeEventListener('getroomly-availability-changed', availabilityHandler);
    }
  });
});
