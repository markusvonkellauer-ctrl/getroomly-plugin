import { AppConfig } from '@/config/app-config';

function getHostGtag(): ((...args: unknown[]) => void) | undefined {
  if (!AppConfig.features.enableAnalytics || !AppConfig.services.analytics.googleAnalyticsId) {
    return undefined;
  }
  const { gtag } = window as Window & { gtag?: (...args: unknown[]) => void };
  return typeof gtag === 'function' ? gtag : undefined;
}

// Fires GA4 "getroomly_interaction" for both Mode A (built-in button) and
// Mode B (partner button with data-getroomly-sku). No-ops silently when
// analytics is disabled or gtag is absent — can never throw into host page.
export function trackInteraction(sku: string, category?: string): void {
  try {
    const gtag = getHostGtag();
    if (gtag) {
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

// Fires GA4 "select_content" on the widget modal actually opening/closing —
// distinct from trackInteraction, which only fires on the launch-button
// click. content_id carries the SKU deliberately (not item_id, and items is
// left empty): this is the exact shape a partner's server-side GA4 export
// pipeline may already be built to key off of for a given content_type, so
// changing this shape without coordinating with the partner breaks their
// report silently. No-ops the same way trackInteraction does.
export function trackWidgetLifecycle(action: 'open' | 'close', sku: string): void {
  try {
    const gtag = getHostGtag();
    if (gtag) {
      gtag('event', 'select_content', {
        content_type: 'getroomly_widget',
        content_action: action,
        content_id: sku,
        items: [],
      });
    }
  } catch {
    // intentionally silent — must never crash the host page
  }
}
