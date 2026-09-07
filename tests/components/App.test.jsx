/**
 * App Component Tests — partner-availability-gated trigger button
 */

import { render, screen, waitFor } from '@testing-library/react';
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
