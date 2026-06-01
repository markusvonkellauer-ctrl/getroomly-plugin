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

      if (!embedConfig.productImage) {
        setError('Product image URL is required in GetRoomlyEmbedConfig.productImage');
        return;
      }

      if (!embedConfig.sku) {
        setError('Product SKU is required in GetRoomlyEmbedConfig.sku');
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
