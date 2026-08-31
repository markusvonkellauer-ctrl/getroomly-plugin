import { useState, useEffect } from 'react';
import { AppConfig } from '@/config/app-config';
import type { EmbedConfig } from '@/types/embed-config';
import { detectLanguageFromTLD, isSupportedLanguage } from '@/lib/i18n';

/**
 * Hook to manage embed configuration from window.GetRoomlyEmbedConfig
 */
export function useEmbedConfig() {
  const [config, setConfig] = useState<EmbedConfig | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkConfig = () => {
      const embedConfig = window.GetRoomlyEmbedConfig;

      if (!embedConfig) {
        setError('GetRoomly configuration not found. Please set window.GetRoomlyEmbedConfig.');
        return;
      }

      // apiKey is required. A `VITE_GETROOMLY_API_KEY` build-time env can satisfy this
      // for local plugin development, but the published bundle has no key — host pages
      // must always provide one via window.GetRoomlyEmbedConfig.apiKey.
      if (!embedConfig.apiKey && !AppConfig.ai.defaultApiKey) {
        setError('Partner API key is required in GetRoomlyEmbedConfig.apiKey');
        return;
      }

      if (!embedConfig.productImage) {
        setError('Product image URL is required in GetRoomlyEmbedConfig.productImage');
        return;
      }

      if (!embedConfig.sku) {
        setError('Product SKU is required in GetRoomlyEmbedConfig.sku');
        return;
      }

      if (!embedConfig.productName) {
        setError('Product name is required in GetRoomlyEmbedConfig.productName');
        return;
      }

      if (!embedConfig.category) {
        setError('Product category is required in GetRoomlyEmbedConfig.category');
        return;
      }

      const m = embedConfig.measurements;
      if (
        !m ||
        typeof m.width !== 'number' ||
        typeof m.depth !== 'number' ||
        typeof m.height !== 'number'
      ) {
        setError(
          'Product measurements {width, depth, height} in cm are required in GetRoomlyEmbedConfig.measurements'
        );
        return;
      }

      // window.GetRoomlyEmbedConfig is set by the host page's own untyped JS —
      // embedConfig.language can be any string at runtime regardless of what
      // the EmbedConfig type claims. Validate before it's allowed to win over
      // the TLD-derived default, so a typo'd or stale value (e.g. 'ger'
      // instead of 'de') falls back safely instead of silently propagating
      // into every downstream consumer of config.language — including the
      // /v1/generate request body, where an invalid code gets a hard 400 from
      // the backend and breaks generation entirely, not just the UI text.
      const resolvedLanguage = isSupportedLanguage(embedConfig.language)
        ? embedConfig.language
        : detectLanguageFromTLD();

      const configWithDefaults: EmbedConfig = {
        showSteps: false,
        buttons: {
          addToBasket: true,
          favorite: true,
          feedback: true,
          showOriginal: true,
          saveShare: true,
          ...embedConfig.buttons,
        },
        ...embedConfig,
        // Placed after the spread so the validated value always wins over
        // whatever embedConfig.language raw held (valid or not).
        language: resolvedLanguage,
      };

      setConfig(configWithDefaults);
      setIsReady(true);
      setError(null);

      if (AppConfig.isDevelopment) {
        console.log('🎯 GetRoomly Embed Config loaded:', configWithDefaults);
      }
    };

    checkConfig();

    // Also check when DOM is ready (in case script loads after this component)
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', checkConfig);
    }

    // The shadow-DOM plugin root is created once per page load and never
    // remounted (see shadow-entry.tsx's `pluginInstance` guard), so without
    // this listener `config` would be captured only from whatever
    // window.GetRoomlyEmbedConfig held at the very first open — later opens
    // for a different product, or a newly picked size on the same product,
    // would silently keep using that stale snapshot. Re-reading on every
    // open keeps it in sync with whatever the host page just set.
    window.addEventListener('getroomly-open-modal', checkConfig);

    return () => {
      document.removeEventListener('DOMContentLoaded', checkConfig);
      window.removeEventListener('getroomly-open-modal', checkConfig);
    };
  }, []);

  return { config, isReady, error };
}
