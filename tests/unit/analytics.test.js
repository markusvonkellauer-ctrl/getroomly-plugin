/**
 * lib/analytics Tests
 */

import { AppConfig } from '@/config/app-config';
import { trackInteraction, trackWidgetLifecycle } from '@/lib/analytics';

describe('lib/analytics', () => {
  let originalEnableAnalytics;
  let originalGaId;
  let gtagSpy;

  beforeEach(() => {
    originalEnableAnalytics = AppConfig.features.enableAnalytics;
    originalGaId = AppConfig.services.analytics.googleAnalyticsId;
    AppConfig.features.enableAnalytics = true;
    AppConfig.services.analytics.googleAnalyticsId = 'G-TEST123';
    gtagSpy = jest.fn();
    window.gtag = gtagSpy;
  });

  afterEach(() => {
    AppConfig.features.enableAnalytics = originalEnableAnalytics;
    AppConfig.services.analytics.googleAnalyticsId = originalGaId;
    delete window.gtag;
  });

  describe('trackWidgetLifecycle', () => {
    it('fires select_content with content_action "open", the SKU in content_id, and an empty items array', () => {
      // This exact shape is what a partner's own GA4-export pipeline may
      // already be built to key off of for content_type: 'getroomly_widget'
      // -- content_id (not item_id) carries the SKU, and items stays empty
      // deliberately. Changing this shape without coordinating with the
      // partner breaks their report silently, so this pins the contract.
      trackWidgetLifecycle('open', 'sku-123');

      expect(gtagSpy).toHaveBeenCalledWith('event', 'select_content', {
        content_type: 'getroomly_widget',
        content_action: 'open',
        content_id: 'sku-123',
        items: [],
      });
    });

    it('fires select_content with content_action "close"', () => {
      trackWidgetLifecycle('close', 'sku-123');

      expect(gtagSpy).toHaveBeenCalledWith('event', 'select_content', {
        content_type: 'getroomly_widget',
        content_action: 'close',
        content_id: 'sku-123',
        items: [],
      });
    });

    it('does not call gtag when analytics is disabled', () => {
      AppConfig.features.enableAnalytics = false;

      trackWidgetLifecycle('open', 'sku-123');

      expect(gtagSpy).not.toHaveBeenCalled();
    });

    it('does not call gtag when no GA measurement id is configured', () => {
      AppConfig.services.analytics.googleAnalyticsId = undefined;

      trackWidgetLifecycle('open', 'sku-123');

      expect(gtagSpy).not.toHaveBeenCalled();
    });

    it('does not throw when window.gtag is absent', () => {
      delete window.gtag;

      expect(() => trackWidgetLifecycle('open', 'sku-123')).not.toThrow();
    });

    it('never throws into the host page even if gtag itself throws', () => {
      window.gtag = () => {
        throw new Error('boom');
      };

      expect(() => trackWidgetLifecycle('open', 'sku-123')).not.toThrow();
    });
  });

  describe('trackInteraction', () => {
    // Regression guard: trackWidgetLifecycle and trackInteraction now share
    // a getHostGtag() guard helper -- this pins that the refactor didn't
    // change trackInteraction's own existing event shape or behavior.
    it('still fires getroomly_interaction with product_sku/product_category', () => {
      trackInteraction('sku-123', 'rugs');

      expect(gtagSpy).toHaveBeenCalledWith('set', 'user_properties', {
        getroomly_active_user: 'true',
      });
      expect(gtagSpy).toHaveBeenCalledWith('event', 'getroomly_interaction', {
        product_sku: 'sku-123',
        product_category: 'rugs',
      });
    });

    it('defaults product_category to "unknown" when none is passed', () => {
      trackInteraction('sku-123');

      expect(gtagSpy).toHaveBeenCalledWith('event', 'getroomly_interaction', {
        product_sku: 'sku-123',
        product_category: 'unknown',
      });
    });

    it('does not call gtag when analytics is disabled', () => {
      AppConfig.features.enableAnalytics = false;

      trackInteraction('sku-123');

      expect(gtagSpy).not.toHaveBeenCalled();
    });
  });
});
