import { AppConfig } from '@/config/app-config';

// Fires GA4 "getroomly_interaction" for both Mode A (built-in button) and
// Mode B (partner button with data-getroomly-sku). No-ops silently when
// analytics is disabled or gtag is absent — can never throw into host page.
export function trackInteraction(sku: string, category?: string): void {
  if (!AppConfig.features.enableAnalytics || !AppConfig.services.analytics.googleAnalyticsId) {
    return;
  }
  try {
    if (typeof (window as Window & { gtag?: unknown }).gtag === 'function') {
      const gtag = (window as Window & { gtag: (...args: unknown[]) => void }).gtag;
      gtag('set', 'user_properties', { getroomly_active_user: 'true' });
      gtag('event', 'getroomly_interaction', {
        product_sku: sku,
        product_category: category || 'unknown',
      });
    }
  } catch {
    // intentionally silent — must never crash the host page
  }
}
