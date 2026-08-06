import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppConfig } from '@/config/app-config';
import { useEmbedConfig } from '@/hooks/use-embed-config';
import { EmbedButton } from '@/components/EmbedButton';
import { RoomVisualizationFlow } from '@/components/RoomVisualizationFlow';
import { trackInteraction } from '@/lib/analytics';
import './App.css';

const queryClient = new QueryClient();

function App() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { config, isReady, error } = useEmbedConfig();

  // Keep a ref to the latest config.category so the Mode B listener
  // always reads the current value without needing to re-register.
  const categoryRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    categoryRef.current = config?.category;
  }, [config]);

  // Mode B: delegated click listener for partner buttons with data-getroomly-sku.
  // Runs once on mount; uses categoryRef to avoid stale closure.
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest('[data-getroomly-sku]');
      if (target) {
        trackInteraction(target.getAttribute('data-getroomly-sku') || '', categoryRef.current);
      }
    };
    document.addEventListener('click', handleDocumentClick);
    return () => {
      document.removeEventListener('click', handleDocumentClick);
    };
  }, []);

  // Lock host page scroll when modal is open — prevents iOS rubber-band
  // scroll from propagating to the body and making the fixed modal jump.
  useEffect(() => {
    if (isModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isModalOpen]);

  // Listen for external open/close events from host page
  useEffect(() => {
    const handleOpen = () => setIsModalOpen(true);
    const handleClose = () => setIsModalOpen(false);

    window.addEventListener('getroomly-open-modal', handleOpen);
    window.addEventListener('getroomly-close-modal', handleClose);

    return () => {
      window.removeEventListener('getroomly-open-modal', handleOpen);
      window.removeEventListener('getroomly-close-modal', handleClose);
    };
  }, []);

  // Show loading state while config is being loaded
  if (!isReady) {
    return (
      <div
        style={{
          padding: '20px',
          textAlign: 'center',
          fontFamily: AppConfig.ui.defaultLanguage === 'en' ? 'system-ui' : 'sans-serif',
        }}
      >
        <p>GetRoomly: Loading configuration...</p>
        {error && <small style={{ color: '#e74c3c' }}>{error}</small>}
      </div>
    );
  }

  // Show error state if config is invalid
  if (error || !config) {
    return (
      <div
        style={{
          padding: '20px',
          textAlign: 'center',
          color: '#e74c3c',
          fontFamily: AppConfig.ui.defaultLanguage === 'en' ? 'system-ui' : 'sans-serif',
        }}
      >
        <p>⚠️ GetRoomly Configuration Error</p>
        <small>{error || 'Invalid configuration'}</small>
      </div>
    );
  }

  const handleModalClose = () => {
    setIsModalOpen(false);
    // Call callback if provided
    config.callbacks?.onModalClose?.();
    // Dispatch event so host can sync state (used by ShadowDOMWrapper)
    window.dispatchEvent(new CustomEvent('getroomly-modal-closed'));
  };

  // Shadow DOM mode: shows button + modal (modal can also be opened externally via window.GetRoomly.open())
  const hideButton = config.hideButton === true;

  return (
    <QueryClientProvider client={queryClient}>
      <div
        className="getroomly-embed"
        style={{ backgroundColor: '#ffffff', minHeight: hideButton ? '0' : '100vh' }}
      >
        {/* Main Embed Button (hidden when controlled externally via window.GetRoomly.open()) */}
        {!hideButton && <EmbedButton config={config} onClick={() => setIsModalOpen(true)} />}

        {/* Original Modal System with Plugin Content */}
        {isModalOpen && (
          <>
            <div
              className="fixed inset-0 z-50 bg-black/80"
              style={{ pointerEvents: 'auto', touchAction: 'none' }}
              onClick={handleModalClose}
            />
            {/* Positioning wrapper — static, never animated. Keeps the centering
                transform isolated so framer-motion's layout transform on the
                inner motion.div doesn't conflict with translate(-50%, -50%). */}
            <div
              style={{
                pointerEvents: 'none',
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 50,
                width: '100%',
                maxWidth: '520px',
              }}
            >
              {/* Animated visual dialog — layout="size" smoothly interpolates
                  height as step content changes (Upload → Processing → Result). */}
              <motion.div
                role="dialog"
                layout="size"
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                className="getroomly-modal-container rounded-2xl flex flex-col gap-0 overflow-hidden bg-background border shadow-2xl"
                style={{ pointerEvents: 'auto' }}
                onClick={e => e.stopPropagation()}
              >
                <RoomVisualizationFlow
                  productImages={[config.productImage]}
                  productId={config.sku}
                  category={config.category}
                  productName={config.productName}
                  productPrice={config.productPrice ?? 0}
                  measurements={config.measurements}
                  showSteps={config.showSteps}
                  config={config}
                  onClose={handleModalClose}
                  onComplete={imageUrl => {
                    config.callbacks?.onImageGenerated?.(imageUrl);
                  }}
                  onError={error => {
                    config.callbacks?.onError?.(error);
                  }}
                />
              </motion.div>
            </div>
          </>
        )}
      </div>
    </QueryClientProvider>
  );
}

export default App;
