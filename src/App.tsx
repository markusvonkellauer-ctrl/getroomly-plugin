import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppConfig } from '@/config/app-config';
import { useEmbedConfig } from '@/hooks/use-embed-config';
import { EmbedButton } from '@/components/EmbedButton';
import { RoomVisualizationFlow } from '@/components/RoomVisualizationFlow';
import { trackInteraction } from '@/lib/analytics';
import {
  getAvailability,
  notifyAvailabilityChanged,
  setAvailabilityValue,
} from '@/lib/availability-state';
import { checkPartnerAvailability } from '@/services/partner-status';
import './App.css';

const queryClient = new QueryClient();

function App() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { config, isReady, error } = useEmbedConfig();

  // Tracks which apiKey the stored result actually belongs to, so a stale
  // result from a previous key can be recognised as stale during render —
  // no setState-during-render and no synchronous setState inside the effect
  // (both flagged by lint/review as risky), just a derived comparison below.
  const [availabilityResult, setAvailabilityResult] = useState({
    key: undefined as string | undefined,
    available: true,
  });

  useEffect(() => {
    if (!config?.apiKey) {
      return;
    }
    let cancelled = false;
    checkPartnerAvailability(config.apiKey).then(available => {
      if (!cancelled) {
        setAvailabilityResult({ key: config.apiKey, available });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [config?.apiKey]);

  // Optimistic default (true) for a key whose check hasn't resolved yet, or
  // whose stored result belongs to a since-replaced key (e.g. the host page
  // updates window.GetRoomlyEmbedConfig.apiKey between opens) — a stale
  // `false` from a previous key must never carry over to a new one.
  // checkPartnerAvailability itself fails open too, so a check that errors
  // out never wrongly hides a working button either.
  const partnerAvailable =
    availabilityResult.key === config?.apiKey ? availabilityResult.available : true;

  // Publish to the shared module-level state so window.GetRoomly.open()
  // (defined outside React, in shadow-entry.tsx) and host pages listening
  // for 'getroomly-availability-changed' both see the current value —
  // e.g. a host that built its own trigger button (hideButton: true)
  // instead of using the default EmbedButton can hide it too.
  //
  // The cached VALUE is updated in a useLayoutEffect, not during render —
  // mutating external state during render is unsafe under React 18
  // concurrent rendering, since a render that gets interrupted/discarded
  // could still have run that mutation. useLayoutEffect only ever runs for
  // renders that actually commit, and fires synchronously right after
  // commit (before paint) — as close to render-time freshness as is
  // actually safe, effectively closing the staleness window a passive
  // effect would leave. The event dispatch itself (an unambiguous side
  // effect) stays in a regular effect — no need for it to block paint.
  useLayoutEffect(() => {
    setAvailabilityValue(partnerAvailable);
  }, [partnerAvailable]);
  useEffect(() => {
    notifyAvailabilityChanged(partnerAvailable);
  }, [partnerAvailable]);

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
    // Safety net: even if a host page's own custom trigger button (built
    // via hideButton: true) is still visible or gets clicked in a race, the
    // modal itself refuses to open for a partner that's suspended for
    // quota. GetRoomly.open() already checks this too (shadow-entry.tsx) —
    // reading getAvailability() directly here (rather than a separately-
    // synced ref) means both checks always agree, since the useLayoutEffect
    // above keeps it current — synchronously, right after commit — before
    // this handler could ever run.
    const handleOpen = () => {
      if (getAvailability()) {
        setIsModalOpen(true);
        // Confirms the modal actually opened, distinct from
        // 'getroomly-open-modal' which only means opening was *requested* —
        // shadow-entry.tsx's isModalOpen flag listens for this one instead,
        // so it doesn't go stale by assuming every request succeeded (it
        // doesn't, when unavailable).
        window.dispatchEvent(new CustomEvent('getroomly-modal-opened'));
      }
    };
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
  const showButton = !hideButton && partnerAvailable;

  return (
    <QueryClientProvider client={queryClient}>
      <div
        className="getroomly-embed"
        style={{ backgroundColor: '#ffffff', minHeight: showButton ? '100vh' : '0' }}
      >
        {/* Main Embed Button (hidden when controlled externally via window.GetRoomly.open(),
            or when the partner has hit their render quota) */}
        {showButton && <EmbedButton config={config} onClick={() => setIsModalOpen(true)} />}

        {/* Original Modal System with Plugin Content */}
        {isModalOpen && (
          <>
            <div
              className="fixed inset-0 z-50 bg-black/80"
              style={{ pointerEvents: 'auto', touchAction: 'none' }}
              onClick={handleModalClose}
            />
            <div
              role="dialog"
              className="getroomly-modal-container rounded-2xl flex flex-col gap-0 transition-all duration-300 overflow-hidden bg-background border shadow-2xl"
              style={{
                pointerEvents: 'auto',
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 50,
                width: '100%',
                maxWidth: '520px',
              }}
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
            </div>
          </>
        )}
      </div>
    </QueryClientProvider>
  );
}

export default App;
