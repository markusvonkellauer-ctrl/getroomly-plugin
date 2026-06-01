import { useState, useEffect } from 'react';
import { AppConfig } from '@/config/app-config';
import type { EmbedConfig } from '@/types/embed-config';

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
      if (!m || typeof m.width !== 'number' || typeof m.depth !== 'number' || typeof m.height !== 'number') {
        setError('Product measurements {width, depth, height} in cm are required in GetRoomlyEmbedConfig.measurements');
        return;
      }

      const configWithDefaults: EmbedConfig = {
        language: 'en',
        debugCoordinates: AppConfig.features.debugCoordinates,
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
      return () => {
        document.removeEventListener('DOMContentLoaded', checkConfig);
      };
    }
  }, []);

  return { config, isReady, error };
}
