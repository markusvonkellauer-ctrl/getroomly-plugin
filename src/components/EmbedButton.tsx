import { AppConfig } from '@/config/app-config';
import type { EmbedConfig } from '@/types/embed-config';

interface EmbedButtonProps {
  config: EmbedConfig;
  onClick: () => void;
}

export function EmbedButton({ config, onClick }: EmbedButtonProps) {
  const { buttonText = 'Visualize in Your Room', styling = {} } = config;

  const { buttonColor = '#000', buttonTextColor = '#fff', borderRadius = '0' } = styling;

  const handleClick = () => {
    // Call callback if provided
    config.callbacks?.onModalOpen?.();

    // Analytics tracking
    if (AppConfig.features.enableAnalytics && AppConfig.services.analytics.googleAnalyticsId) {
      // Track button click event
      if (typeof (window as any).gtag !== 'undefined') {
        (window as any).gtag('event', 'embed_button_click', {
          product_sku: config.sku,
          product_category: config.category || 'unknown',
        });
      }
    }

    onClick();
  };

  return (
    <button
      onClick={handleClick}
      className="getroomly-trigger-button"
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--getroomly-space-sm)',
        padding: 'var(--getroomly-space-lg)',
        fontSize: 'var(--getroomly-font-base)',
        fontWeight: 'bold',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        transition: 'all var(--getroomly-transition-slow)',
        backgroundColor: buttonColor,
        color: buttonTextColor,
        border: 'none',
        borderRadius: borderRadius,
        cursor: 'pointer',
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
      }}
      onMouseOver={e => {
        e.currentTarget.style.transform = 'scale(1.02)';
        e.currentTarget.style.filter = 'brightness(1.1)';
      }}
      onMouseOut={e => {
        e.currentTarget.style.transform = 'scale(1)';
        e.currentTarget.style.filter = 'brightness(1)';
      }}
    >
      <span>{buttonText}</span>
      <span
        style={{
          background: 'rgba(255,255,255,0.2)',
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '10px',
          fontWeight: '900',
          border: '1px solid rgba(255,255,255,0.2)',
        }}
      >
        AI
      </span>
    </button>
  );
}
