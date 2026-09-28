/**
 * Widget UX-funnel event tracking (POST /v1/event) tests
 */

import { trackWidgetEvent } from '../../src/services/event-tracking';

global.fetch = jest.fn();

// flushes the microtask queue so the internal (unawaited) fetch promise
// chain has a chance to run before assertions/cleanup
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('trackWidgetEvent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('POSTs eventType, sessionId, and productId with the API key header', () => {
    fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    trackWidgetEvent('grm_pub_test', 'widget_opened', 'sess-1', 'rug-001');

    expect(fetch).toHaveBeenCalledTimes(1);
    const [endpoint, options] = fetch.mock.calls[0];
    expect(endpoint).toMatch(/\/v1\/event$/);
    expect(options.method).toBe('POST');
    expect(options.headers['X-API-Key']).toBe('grm_pub_test');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(options.body)).toEqual({
      eventType: 'widget_opened',
      sessionId: 'sess-1',
      productId: 'rug-001',
    });
  });

  it('omits productId from the serialized body when not provided', () => {
    fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    trackWidgetEvent('grm_pub_test', 'terms_clicked', 'sess-1');

    const [, options] = fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.eventType).toBe('terms_clicked');
    expect(body.sessionId).toBe('sess-1');
    expect('productId' in body).toBe(false);
  });

  it('does not call fetch when no API key is available', () => {
    trackWidgetEvent(undefined, 'widget_opened', 'sess-1', 'rug-001');

    expect(fetch).not.toHaveBeenCalled();
  });

  // Fire-and-forget by design: a failed network request must never surface
  // as an unhandled rejection or an exception into the host page.

  it('does not throw when fetch rejects (network error)', async () => {
    fetch.mockRejectedValueOnce(new Error('network down'));

    expect(() => trackWidgetEvent('grm_pub_test', 'widget_opened', 'sess-1')).not.toThrow();
    await flush();
    expect(console.warn).toHaveBeenCalled();
  });

  it('does not throw when fetch itself throws synchronously', () => {
    fetch.mockImplementationOnce(() => {
      throw new Error('fetch unavailable');
    });

    expect(() => trackWidgetEvent('grm_pub_test', 'widget_opened', 'sess-1')).not.toThrow();
  });

  it('returns immediately (synchronous, fire-and-forget) rather than a Promise the caller must await', () => {
    fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    const result = trackWidgetEvent('grm_pub_test', 'widget_opened', 'sess-1');

    expect(result).toBeUndefined();
  });
});
