import { useState, useEffect, useRef } from 'react';
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
        trackInteraction(
          target.getAttribute('data-getroomly-sku') || '',
          categoryRef.current,
        );
      }
    };
    document.addEventListener('click', handleDocumentClick);
    return () => {
      document.removeEventListener('click', handleDocumentClick);
    };
  }, []);

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
              style={{ pointerEvents: 'auto' }}
              onClick={handleModalClose}
            />
            <div
              role="dialog"
              className="sm:rounded-lg flex flex-col p-3 sm:p-4 gap-0 transition-all duration-300 overflow-hidden bg-background border shadow-2xl"
              style={{
                pointerEvents: 'auto',
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 50,
                width: '100%',
                maxWidth: '520px',
                maxHeight: '80%',
              }}
              onClick={e => e.stopPropagation()}
            >
              <button
                onClick={handleModalClose}
                aria-label="Close"
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '12px',
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(0, 0, 0, 0.06)',
                  color: '#374151',
                  transition: 'all 0.15s ease',
                  zIndex: 10,
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.12)';
                  e.currentTarget.style.transform = 'scale(1.05)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.06)';
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>

              <RoomVisualizationFlow
                productImages={[config.productImage]}
                productId={config.sku}
                category={config.category}
                productName={config.productName}
                productPrice={config.productPrice ?? 0}
                measurements={config.measurements}
                showSteps={config.showSteps}
                config={config}
                onComplete={imageUrl => {
                  config.callbacks?.onImageGenerated?.(imageUrl);
                }}
                onError={error => {
                  config.callbacks?.onError?.(error);
                }}
              />
            </div>
          </>
        )}
      </div>
    </QueryClientProvider>
  );
}

export default App;
