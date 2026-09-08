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
  //
  // Seeded from getAvailability() (lazy initializer, not a hardcoded true):
  // that reads a value persisted from an earlier visit if one exists, so a
  // returning visitor's very first render can already reflect the real
  // answer instead of the optimistic default — the button no longer has to
  // visibly flash before hiding on every single page load for a suspended
  // partner, just the first time a browser ever sees this apiKey.
  //
  // `confirmed` distinguishes that seeded/optimistic starting guess from a
  // result this page load's own checkPartnerAvailability call has actually
  // verified — see the publish effect below for why that distinction
  // matters (it's what stops an unconfirmed guess from being persisted).
  const [availabilityResult, setAvailabilityResult] = useState(() => ({
    key: window.GetRoomlyEmbedConfig?.apiKey,
    available: getAvailability(),
    confirmed: false,
  }));

  useEffect(() => {
    if (!config?.apiKey) {
      return;
    }
    let cancelled = false;
    checkPartnerAvailability(config.apiKey).then(available => {
      if (!cancelled) {
        setAvailabilityResult({ key: config.apiKey, available, confirmed: true });
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
  //
  // Compared against window.GetRoomlyEmbedConfig?.apiKey directly, not
  // config?.apiKey: config is still null on the very first render (isReady
  // starts false), which would otherwise always take this else-branch on
  // mount and throw away the value getAvailability() just seeded above.
  // The two agree once config resolves — useEmbedConfig reads apiKey
  // straight through with no transformation.
  const partnerAvailable =
    availabilityResult.key === window.GetRoomlyEmbedConfig?.apiKey
      ? availabilityResult.available
      : true;

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
  // Only publishes once THIS page load's own check has actually confirmed a
  // result for the current key — not on the seeded/optimistic starting
  // guess. setAvailabilityValue also persists to localStorage (see
  // availability-state.ts); publishing an unconfirmed guess would write it
  // there too, "poisoning" the cache for future visits if the user
  // navigates away before the real check resolves. getAvailability() itself
  // already falls back to the persisted value independently (for any
  // caller, not just App.tsx), so skipping the unconfirmed publish here
  // loses nothing.
  useLayoutEffect(() => {
    if (availabilityResult.confirmed) {
      setAvailabilityValue(availabilityResult.key, availabilityResult.available);
    }
  }, [availabilityResult]);
  useEffect(() => {
    notifyAvailabilityChanged(partnerAvailable);
  }, [partnerAvailable]);

  // Keep a ref to the latest config.category so the Mode B listener
  // always reads the current value without needing to re-register.
  const categoryRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    categoryRef.current = config?.category;
  }, [config]);

  // Mirrors the same readiness/validity check the early-return JSX below
  // uses to decide whether the modal can render at all. Read by handleOpen
  // (below) via a ref rather than a dependency array, so the mount-once
  // 'getroomly-open-modal' listener always sees the current value without
  // needing to re-register on every config change.
  //
  // useLayoutEffect, not useEffect: a passive effect leaves a window right
  // after commit — where isReady/error/config are already updated but this
  // ref hasn't caught up yet — during which a synchronous 'getroomly-open-
  // modal' dispatch would be incorrectly refused even though the modal can
  // by then actually render. Same reasoning as setAvailabilityValue above.
  const configReadyRef = useRef(false);
  useLayoutEffect(() => {
    configReadyRef.current = isReady && !error && !!config;
  }, [isReady, error, config]);

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

  // Confirms the modal's actual open/closed state to shadow-entry.tsx
  // (window.GetRoomly.isOpen()), regardless of which of the several paths
  // caused isModalOpen to change: the default EmbedButton's onClick, the
  // 'getroomly-open-modal'/'getroomly-close-modal' request events below, or
  // a UI-driven close (X button / backdrop, via handleModalClose further
  // down). Centralizing this in one effect keyed off the actual state value
  // — rather than dispatching inline from each of those call sites — means
  // every path is covered automatically and the event can never double-fire
  // for one transition (each of those call sites used to dispatch it
  // manually, which both missed the EmbedButton path entirely and would
  // have double-fired once the close path was added to match).
  //
  // isFirstRender guards against firing a spurious "closed" confirmation
  // for the initial isModalOpen === false on mount, before anything has
  // ever actually opened.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    window.dispatchEvent(
      new CustomEvent(isModalOpen ? 'getroomly-modal-opened' : 'getroomly-modal-closed')
    );
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
      // Refuse to flip isModalOpen (and thus the centralized confirmation
      // effect's 'getroomly-modal-opened' dispatch above) while the modal
      // can't actually render yet — otherwise a host calling open() before
      // config has finished loading, or with an invalid config, would
      // report the modal as opened while the component is still showing
      // its loading/error state instead.
      if (!configReadyRef.current) {
        return;
      }
      if (getAvailability()) {
        setIsModalOpen(true);
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
    // 'getroomly-modal-closed' is dispatched by the centralized isModalOpen
    // effect above, not here — keeps it a single-writer event regardless of
    // which close path (this one, or the 'getroomly-close-modal' listener)
    // caused isModalOpen to become false.
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
