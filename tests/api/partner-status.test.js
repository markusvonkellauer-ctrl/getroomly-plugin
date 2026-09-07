/**
 * Partner Status Check Tests
 */

import { checkPartnerAvailability } from '../../src/services/partner-status';

global.fetch = jest.fn();

describe('checkPartnerAvailability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns true when the backend reports the partner as available', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ available: true }) });

    await expect(checkPartnerAvailability('grm_pub_test')).resolves.toBe(true);
  });

  it('returns false when the backend reports the partner as unavailable', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ available: false }) });

    await expect(checkPartnerAvailability('grm_pub_test')).resolves.toBe(false);
  });

  it('sends the API key as the X-API-Key header', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ available: true }) });

    await checkPartnerAvailability('grm_pub_test');

    const [, options] = fetch.mock.calls[0];
    expect(options.headers['X-API-Key']).toBe('grm_pub_test');
  });

  // Fail-open: a status-check hiccup must never hide a working button — the
  // actual /v1/generate call remains the real enforcement point regardless.

  it('fails open (returns true) with no API key, without calling fetch', async () => {
    await expect(checkPartnerAvailability(undefined)).resolves.toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails open (returns true) on a network error', async () => {
    fetch.mockRejectedValueOnce(new Error('network down'));

    await expect(checkPartnerAvailability('grm_pub_test')).resolves.toBe(true);
  });

  it('fails open (returns true) on a non-OK response', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) });

    await expect(checkPartnerAvailability('grm_pub_test')).resolves.toBe(true);
  });

  it('fails open (returns true) on a malformed JSON body', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.reject(new Error('bad json')) });

    await expect(checkPartnerAvailability('grm_pub_test')).resolves.toBe(true);
  });

  it('treats a body missing the available field as available (only an explicit false hides the button)', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    await expect(checkPartnerAvailability('grm_pub_test')).resolves.toBe(true);
  });
});
