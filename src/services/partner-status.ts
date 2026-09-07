import { AppConfig } from '@/config/app-config';

/**
 * Checks whether this partner can currently generate (not suspended for
 * quota), so the trigger button can be hidden before the customer ever
 * clicks it instead of showing a button that would just fail every time.
 *
 * Fails OPEN — any network error, non-OK response, or malformed body
 * returns `true` (show the button). A status-check hiccup must never hide a
 * working button; the actual `/v1/generate` call remains the real
 * enforcement point regardless of what this check reports.
 */
export async function checkPartnerAvailability(apiKey: string | undefined): Promise<boolean> {
  if (!apiKey) {
    return true;
  }

  try {
    const endpoint = `${AppConfig.api.baseUrl}/v1/partner/status`;
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: { 'X-API-Key': apiKey },
    });

    if (!res.ok) {
      return true;
    }

    const body = await res.json();
    return body?.available !== false;
  } catch (err) {
    console.warn('[Plugin] Partner status check failed, defaulting to available:', err);
    return true;
  }
}
