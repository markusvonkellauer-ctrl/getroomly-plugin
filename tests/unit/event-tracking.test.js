/**
 * services/event-tracking Tests
 */

import { AppConfig } from '@/config/app-config';
import { normalizeEventCategory, trackWidgetEvent } from '@/services/event-tracking';

describe('services/event-tracking', () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchSpy;
  });

  afterEach(() => {
    delete global.fetch;
  });

  const sentBody = () => JSON.parse(fetchSpy.mock.calls[0][1].body);

  describe('normalizeEventCategory', () => {
    it('passes a normal category through, trimmed', () => {
      expect(normalizeEventCategory('Soffor')).toBe('Soffor');
      expect(normalizeEventCategory('  Gångmattor ')).toBe('Gångmattor');
    });

    it('cuts a category to the 128 characters the backend accepts, instead of losing the event to a 400', () => {
      expect(normalizeEventCategory('x'.repeat(200))).toHaveLength(128);
    });

    it('leaves out anything that is not a usable string', () => {
      for (const bad of [undefined, null, '', '   ', 5, {}, ['Soffor']]) {
        expect(normalizeEventCategory(bad)).toBeUndefined();
      }
    });
  });

  describe('trackWidgetEvent', () => {
    it('posts the event to /v1/event with the category', () => {
      trackWidgetEvent('partner-abc', 'result_viewed', 'sess-1', 'sku-1', 'Soffor');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(`${AppConfig.api.baseUrl}/v1/event`);
      expect(init.headers['X-API-Key']).toBe('partner-abc');
      expect(sentBody()).toEqual({
        eventType: 'result_viewed',
        sessionId: 'sess-1',
        productId: 'sku-1',
        category: 'Soffor',
      });
    });

    it('omits the category from the body when there is none, as before this field existed', () => {
      trackWidgetEvent('partner-abc', 'widget_opened', 'sess-1', 'sku-1');

      expect(sentBody()).toEqual({
        eventType: 'widget_opened',
        sessionId: 'sess-1',
        productId: 'sku-1',
      });
    });

    it('omits a blank or non-string category rather than sending an invalid body', () => {
      trackWidgetEvent('partner-abc', 'widget_opened', 'sess-1', 'sku-1', '   ');

      expect('category' in sentBody()).toBe(false);
    });

    it('sends a category cut to 128 characters', () => {
      trackWidgetEvent('partner-abc', 'widget_opened', 'sess-1', 'sku-1', 'y'.repeat(300));

      expect(sentBody().category).toHaveLength(128);
    });

    it('does nothing without an API key', () => {
      const original = AppConfig.ai.defaultApiKey;
      AppConfig.ai.defaultApiKey = '';
      trackWidgetEvent(undefined, 'widget_opened', 'sess-1', 'sku-1', 'Soffor');
      AppConfig.ai.defaultApiKey = original;

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('never throws when the request fails', async () => {
      fetchSpy.mockRejectedValue(new Error('offline'));
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() =>
        trackWidgetEvent('partner-abc', 'widget_opened', 'sess-1', 'sku-1', 'Soffor')
      ).not.toThrow();
      await Promise.resolve();
      warn.mockRestore();
    });
  });
});
