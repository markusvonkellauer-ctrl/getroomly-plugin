import { AppConfig } from '@/config/app-config';

export type WidgetEventType =
  | 'widget_opened'
  | 'widget_closed'
  | 'terms_clicked'
  | 'upload_clicked'
  | 'upload_cancelled'
  | 'upload_completed'
  | 'result_viewed'
  /**
   * Result-screen purchase-intent actions -- previously only reached the
   * host page via config.callbacks (onAddToBasket/onFavorite/onSaveShare),
   * invisible to GetRoomly's own funnel diagnostics. download_clicked and
   * share_clicked are the button click itself, not onSaveShare's shared
   * download mechanics (one Share click can still fall through to a
   * download, but which button the shopper actually pressed is the signal
   * worth keeping distinct).
   */
  | 'add_to_basket_clicked'
  | 'favorite_clicked'
  | 'share_clicked'
  | 'download_clicked';

/**
 * Fire-and-forget report of one widget UX-funnel step to GetRoomly's own
 * backend (POST /v1/event) — distinct from the GA4 events in lib/analytics.ts,
 * which are aimed at a partner's own attribution report and only cover
 * modal open/close. This is GetRoomly's own source of truth for where
 * shoppers drop off inside the widget itself (e.g. opened but never
 * uploaded, or generated but never saw the result).
 *
 * Always active (no enableAnalytics gate, unlike analytics.ts's GA4 calls)
 * — this is first-party product telemetry, not a partner-configured
 * third-party integration. Synchronous from the caller's perspective and
 * never throws: a missing apiKey, a network failure, or any other error
 * just silently no-ops, the same defensive contract analytics.ts's
 * functions already follow for the same reason (must never crash the host
 * page).
 */
export function trackWidgetEvent(
  apiKey: string | undefined,
  eventType: WidgetEventType,
  sessionId: string,
  productId?: string
): void {
  try {
    const key = apiKey || AppConfig.ai.defaultApiKey;
    if (!key) {
      return;
    }
    const endpoint = `${AppConfig.api.baseUrl}/v1/event`;
    fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': key,
      },
      body: JSON.stringify({ eventType, sessionId, productId }),
    }).catch(err => {
      console.warn('[Plugin] Failed to report widget event:', eventType, err);
    });
  } catch {
    // intentionally silent — must never crash the host page
  }
}
