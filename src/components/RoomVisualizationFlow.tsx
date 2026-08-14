import React, { useState, useRef, useEffect, useCallback } from 'react';
import { generateRoomVisualization, validateImageFile } from '@/services/ai-generation';
import type { EmbedConfig } from '@/types/embed-config';
import { getTranslations } from '@/lib/i18n';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

interface RoomVisualizationFlowProps {
  productImages: string[];
  productId: string;
  category: string;
  productName: string;
  productPrice: number;
  measurements: {
    width: number;
    depth: number;
    height: number;
  };
  showSteps?: boolean;
  onClose?: () => void;
  onComplete?: (imageUrl: string) => void;
  onError?: (error: string) => void;
  config?: EmbedConfig;
}

export function RoomVisualizationFlow({
  productImages,
  productId,
  category,
  productName,
  productPrice: _productPrice,
  measurements,
  showSteps = true,
  onClose,
  onComplete,
  onError,
  config,
}: RoomVisualizationFlowProps) {
  const t = getTranslations(config?.language);
  const [step, setStep] = useState<'upload' | 'processing' | 'result'>('upload');
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // One sessionId per plugin instance — sent on every generate, indexed in backend RenderLog for support tracing
  const [sessionId] = useState<string>(
    () =>
      crypto.randomUUID?.() ?? `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );

  // Sophisticated loading state
  const [progress, setProgress] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);

  // Result step state
  const [showOriginalImage, setShowOriginalImage] = useState(false);
  const [saveShareDropdownOpen, setSaveShareDropdownOpen] = useState(false);
  const [isFavorited, setIsFavorited] = useState(config?.isFavorite ?? false);
  const [hasSubmittedFeedback, setHasSubmittedFeedback] = useState(false);

  // Explicit pixel dimensions per image — the container adapts to whichever
  // image is currently displayed. Matches Google NanoBanana's approach: full
  // image always visible in its natural ratio, whether portrait or landscape.
  // Two separate states so toggling between "New Design" and "Original Room"
  // resizes the container to fit each image individually.
  const [resultSize, setResultSize] = useState<{ w: number; h: number } | null>(null);
  const [originalSize, setOriginalSize] = useState<{ w: number; h: number } | null>(null);
  const containerSize = showOriginalImage ? originalSize : resultSize;

  // Pinch-to-zoom: scale is stored alongside the image it belongs to so it
  // resets automatically whenever resultImage changes — no effect needed.
  const [zoomState, setZoomState] = useState<{ scale: number; forImage: string | null }>({
    scale: 1,
    forImage: null,
  });
  const imageScale = zoomState.forImage === resultImage ? zoomState.scale : 1;

  const imageContainerRef = useRef<HTMLDivElement>(null);
  const pinchRef = useRef<{ startDist: number; startScale: number } | null>(null);
  const lastTapRef = useRef(0);

  // Mutable refs so touch handlers can read latest values without being in the
  // effect dep array (avoids re-registering listeners on every scale update).
  const imageScaleRef = useRef(imageScale);
  const resultImageRef = useRef(resultImage);
  useEffect(() => {
    imageScaleRef.current = imageScale;
    resultImageRef.current = resultImage;
  });

  const setImageScale = useCallback(
    (next: number) => setZoomState({ scale: next, forImage: resultImageRef.current }),
    []
  );

  // Listen for external favorite state changes from host page
  useEffect(() => {
    const handleFavoriteChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.productId === productId) {
        setIsFavorited(customEvent.detail.isFavorite);
      }
    };
    window.addEventListener('getroomly-set-favorite', handleFavoriteChange);
    return () => window.removeEventListener('getroomly-set-favorite', handleFavoriteChange);
  }, [productId]);

  // On mount, ask host page for current favorite status
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('getroomly-check-favorite', {
        detail: { productId },
      })
    );
  }, [productId]);

  // Terms dialog state
  const [showTermsDialog, setShowTermsDialog] = useState(false);

  const uploadedImageRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressTimerRef = useRef<number | null>(null);
  const messageCyclerRef = useRef<number | null>(null);
  const timeoutTimerRef = useRef<number | null>(null);

  // Sophisticated loading progress effect (matches original frontend exactly)
  useEffect(() => {
    if (step === 'processing' && isGenerating) {
      // Progress algorithm: 0→90% in 14s, then 0.2% every 100ms creep forever
      const totalDuration = 14000; // 14 seconds to reach 90%
      const updateInterval = 100; // Update every 100ms
      const stepIncrement = 90 / (totalDuration / updateInterval);

      progressTimerRef.current = window.setInterval(() => {
        setProgress(prev => {
          if (prev < 90) {
            const next = prev + stepIncrement;
            return next >= 90 ? 90 : next;
          }
          // Above 90%: creep at 0.2% per 100ms — never stops until image arrives
          return prev >= 99.8 ? 99.8 : prev + 0.2;
        });
      }, updateInterval);

      // Message cycler every 3 seconds
      messageCyclerRef.current = window.setInterval(() => {
        setMessageIndex(prev => (prev + 1) % t.loadingMessages.length);
      }, 3000);

      // 30s timeout for long loading message
      timeoutTimerRef.current = window.setTimeout(() => {}, 30000);
    }

    // Cleanup on step change or unmount
    return () => {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      if (messageCyclerRef.current) {
        clearInterval(messageCyclerRef.current);
        messageCyclerRef.current = null;
      }
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
    };
  }, [step, isGenerating, t.loadingMessages.length]);

  const handleGenerate = async (file: File) => {
    setIsGenerating(true);
    setProgress(0);
    setMessageIndex(0);
    setStep('processing');

    try {
      const result = await generateRoomVisualization({
        imageBlob: file,
        productImage: productImages && productImages.length > 0 ? productImages[0] : '',
        productInfo: {
          name: productName,
          category: category,
          productId: productId,
          measurements: measurements,
        },
        language: config?.language ?? 'en',
        apiKey: config?.apiKey,
        sessionId: sessionId,
      });

      setResultImage(result.imageUrl);
      setStep('result');
      onComplete?.(result.imageUrl);
    } catch (err) {
      console.error('Generation error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to generate image';

      // Reset to clean upload state — no error shown in the plugin.
      // The host website handles error display via the event / onError callback.
      if (uploadedImageRef.current) {
        URL.revokeObjectURL(uploadedImageRef.current);
        uploadedImageRef.current = null;
      }
      setUploadedImage(null);
      setResultImage(null);
      setStep('upload');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      window.dispatchEvent(
        new CustomEvent('getroomly-error', {
          detail: { error: errorMsg, productId, sessionId },
        })
      );
      onError?.(errorMsg);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const validation = validateImageFile(file);
    if (!validation.isValid) {
      const errorMsg = validation.error || 'Invalid file';
      console.error('[Plugin] Validation error:', errorMsg);
      window.dispatchEvent(
        new CustomEvent('getroomly-error', {
          detail: { error: errorMsg, productId, sessionId },
        })
      );
      onError?.(errorMsg);
      return;
    }

    if (uploadedImageRef.current) {
      URL.revokeObjectURL(uploadedImageRef.current);
    }

    const url = URL.createObjectURL(file);
    uploadedImageRef.current = url;
    setUploadedImage(url);

    // DEBUG: log what iOS delivers to the browser
    const debugImg = new Image();
    debugImg.onload = () => {
      console.log(`[DEBUG] iOS-delivered file: ${file.size} bytes, type=${file.type}`);
      console.log(
        `[DEBUG] new Image() naturalSize: ${debugImg.naturalWidth}x${debugImg.naturalHeight} ratio=${(debugImg.naturalWidth / debugImg.naturalHeight).toFixed(3)}`
      );
    };
    debugImg.src = url;

    handleGenerate(file);
  };

  const handleNewPhoto = () => {
    if (uploadedImageRef.current) {
      URL.revokeObjectURL(uploadedImageRef.current);
      uploadedImageRef.current = null;
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    setStep('upload');
    setUploadedImage(null);
    setResultImage(null);
    setResultSize(null);
    setOriginalSize(null);
    setHasSubmittedFeedback(false);
    setShowOriginalImage(false);
  };

  const handleOpenTerms = () => {
    setShowTermsDialog(true);
  };

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (uploadedImageRef.current) {
        URL.revokeObjectURL(uploadedImageRef.current);
      }
    };
  }, []);

  // Pinch-to-zoom helpers (non-passive listeners required for e.preventDefault())
  const getDistance = useCallback(
    (t1: Touch, t2: Touch) =>
      Math.sqrt(Math.pow(t2.clientX - t1.clientX, 2) + Math.pow(t2.clientY - t1.clientY, 2)),
    []
  );

  useEffect(() => {
    const el = imageContainerRef.current;
    if (!el) {
      return;
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinchRef.current = {
          startDist: getDistance(e.touches[0], e.touches[1]),
          startScale: imageScaleRef.current,
        };
      } else if (e.touches.length === 1) {
        const now = Date.now();
        if (now - lastTapRef.current < 300) {
          setImageScale(1);
        }
        lastTapRef.current = now;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchRef.current) {
        e.preventDefault();
        const newDist = getDistance(e.touches[0], e.touches[1]);
        const ratio = newDist / pinchRef.current.startDist;
        const next = Math.min(Math.max(pinchRef.current.startScale * ratio, 1), 4);
        setImageScale(next);
      }
    };

    const onTouchEnd = () => {
      pinchRef.current = null;
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [getDistance, setImageScale]);

  const renderStepIndicator = (currentStep: 'upload' | 'processing' | 'result') => {
    const steps = [
      { key: 'upload', label: t.stepIndicatorUpload, number: 1 },
      { key: 'processing', label: t.stepIndicatorProcessing, number: 2 },
      { key: 'result', label: t.stepIndicatorResult, number: 3 },
    ];

    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: '32px',
          gap: '8px',
        }}
      >
        {steps.map((stepItem, index) => {
          const isActive = stepItem.key === currentStep;
          const isCompleted = steps.findIndex(s => s.key === currentStep) > index;

          return (
            <div key={stepItem.key} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  backgroundColor: isActive
                    ? 'var(--getroomly-primary)'
                    : isCompleted
                      ? 'var(--getroomly-primary)'
                      : 'var(--getroomly-border-light)',
                  color: isActive || isCompleted ? '#ffffff' : 'var(--getroomly-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  fontWeight: '600',
                  transition: 'all 0.3s ease',
                }}
              >
                {isCompleted ? '✓' : stepItem.number}
              </div>
              <span
                style={{
                  fontSize: '12px',
                  color: isActive
                    ? 'var(--getroomly-primary)'
                    : isCompleted
                      ? 'var(--getroomly-primary)'
                      : 'var(--getroomly-muted)',
                  fontWeight: isActive ? '600' : '500',
                  transition: 'all 0.3s ease',
                }}
              >
                {stepItem.label}
              </span>
              {index < steps.length - 1 && (
                <div
                  style={{
                    width: '24px',
                    height: '2px',
                    backgroundColor: isCompleted
                      ? 'var(--getroomly-primary)'
                      : 'var(--getroomly-border-light)',
                    margin: '0 8px',
                    transition: 'all 0.3s ease',
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderUploadStep = () => (
    <div
      className="getroomly-upload-step"
      style={{
        width: '100%',
        aspectRatio: '5/5',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '24px',
        backgroundColor: 'rgba(0, 0, 0, 0.02)',
        borderRadius: '8px',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        textAlign: 'center',
      }}
    >
      {showSteps && renderStepIndicator('upload')}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          marginTop: '8px',
          cursor: 'pointer',
          transition: 'transform 0.2s ease',
        }}
        onClick={() => fileInputRef.current?.click()}
        onMouseEnter={e => {
          e.currentTarget.style.transform = 'scale(1.05)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = 'scale(1)';
        }}
        onDragOver={e => {
          e.preventDefault();
        }}
        onDrop={e => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) {
            const event = { target: { files: [file] } } as any;
            handleFileSelect(event);
          }
        }}
      >
        <div
          style={{
            backgroundColor: 'hsla(176, 51%, 36%, 0.1)', // bg-primary/10 equivalent
            padding: '16px',
            borderRadius: '50%',
            marginBottom: '12px',
            boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.05)', // shadow-inner
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              width: '28px', // h-7 w-7 equivalent
              height: '28px',
              color: 'var(--getroomly-primary)', // text-primary
            }}
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" x2="12" y1="3" y2="15"></line>
          </svg>
        </div>
        <button
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            whiteSpace: 'nowrap',
            fontSize: '14px',
            backgroundColor: 'var(--getroomly-primary)', // bg-primary
            color: '#ffffff', // text-primary-foreground
            border: 'none',
            borderRadius: '6px',
            padding: '8px 12px',
            fontWeight: 'bold',
            letterSpacing: '0.025em',
            width: '100%',
            maxWidth: '170px',
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
            pointerEvents: 'none',
            transition: 'all 0.2s ease',
            cursor: 'pointer',
          }}
        >
          {t.uploadButton}
        </button>
        <p
          style={{
            marginTop: '8px',
            fontSize: '9px',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: 'rgba(107, 114, 126, 0.5)', // text-muted-foreground/50
            fontWeight: '500',
          }}
        >
          {t.uploadHint}
        </p>
      </div>

      {/* Guidance Text - matching shadow plugin */}
      <div
        style={{
          // alignSelf:stretch fills the flex cross-axis (horizontal) width
          // reliably in iOS Safari. Using width:'100%' in a flex-column with
          // alignItems:'center' can resolve to the parent's border-box (390px)
          // instead of content-box (342px) in Safari, causing text to overflow.
          alignSelf: 'stretch',
          padding: '16px', // p-4
          backgroundColor: 'hsla(30, 20%, 98%, 0.4)', // bg-background/40
          backdropFilter: 'blur(2px)', // backdrop-blur-[2px]
          borderRadius: '8px', // rounded-lg
          border: '1px solid hsla(176, 51%, 36%, 0.05)', // border border-primary/5
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)', // shadow-sm
        }}
      >
        <p
          style={{
            fontSize: '10px', // text-[10px]
            fontWeight: 'bold', // font-bold
            color: 'hsla(176, 51%, 36%, 0.8)', // text-primary/80
            marginBottom: '12px', // mb-3
            textTransform: 'uppercase', // uppercase
            letterSpacing: '0.15em', // tracking-[0.15em]
            textAlign: 'center', // text-center
            borderBottom: '1px solid hsla(176, 51%, 36%, 0.1)', // border-b border-primary/10
            paddingBottom: '8px', // pb-2
          }}
        >
          {t.tipsHeading}
        </p>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px', // space-y-3
            fontSize: '11px', // text-[11px]
            color: 'var(--getroomly-muted)', // text-muted-foreground
            lineHeight: '1.3', // leading-snug
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <span
              style={{
                width: '16px', // w-4
                height: '16px', // h-4
                borderRadius: '50%', // rounded-full
                backgroundColor: 'hsla(176, 51%, 36%, 0.1)', // bg-primary/10
                color: 'var(--getroomly-primary)', // text-primary
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '9px', // text-[9px]
                fontWeight: 'bold', // font-bold
                flexShrink: 0, // shrink-0
              }}
            >
              1
            </span>
            <p style={{ margin: 0, textAlign: 'left', flex: '1 1 0', minWidth: 0 }}>
              <span style={{ fontWeight: '600', color: 'hsla(20, 10%, 15%, 0.8)' }}>
                {t.tip1Label}
              </span>
              <span> {t.tip1Body}</span>
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <span
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                backgroundColor: 'hsla(176, 51%, 36%, 0.1)',
                color: 'var(--getroomly-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '9px',
                fontWeight: 'bold',
                flexShrink: 0,
              }}
            >
              2
            </span>
            <p style={{ margin: 0, textAlign: 'left', flex: '1 1 0', minWidth: 0 }}>
              <span style={{ fontWeight: '600', color: 'hsla(20, 10%, 15%, 0.8)' }}>
                {t.tip2Label}
              </span>
              <span> {t.tip2Body}</span>
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <span
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                backgroundColor: 'hsla(176, 51%, 36%, 0.1)',
                color: 'var(--getroomly-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '9px',
                fontWeight: 'bold',
                flexShrink: 0,
              }}
            >
              3
            </span>
            <p style={{ margin: 0, textAlign: 'left', flex: '1 1 0', minWidth: 0 }}>
              <span style={{ fontWeight: '600', color: 'hsla(20, 10%, 15%, 0.8)' }}>
                {t.tip3Label}
              </span>
              <span> {t.tip3Body}</span>
            </p>
          </div>
        </div>
      </div>

      {uploadedImage && (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#ffffff',
          }}
        >
          <img
            src={uploadedImage}
            alt="Uploaded room"
            className="object-cover"
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
            }}
          />
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />
    </div>
  );

  const renderProcessingStep = () => (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '5/5',
        maxHeight: '100%',
        background: '#0a111a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      <img
        src={uploadedImage || ''}
        alt="Room being processed"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
          opacity: progress >= 85 ? 0.9 : 0.4,
          filter: progress >= 85 ? 'blur(0px) grayscale(0%)' : 'blur(4px) grayscale(60%)',
          transition: 'all 1000ms ease',
        }}
      />

      {/* Central Spinner */}
      <div
        style={{
          position: 'absolute',
          inset: '0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          zIndex: 30,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            background: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(12px)',
            borderRadius: '50%',
            padding: '24px',
            boxShadow: '0 0 40px color-mix(in srgb, var(--getroomly-primary) 40%, transparent)',
            border: '1px solid color-mix(in srgb, var(--getroomly-primary) 40%, transparent)',
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              border: '2.5px solid color-mix(in srgb, var(--getroomly-primary) 30%, transparent)',
              borderTop: '2.5px solid var(--getroomly-primary)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }}
          />
        </div>
      </div>
    </div>
  );

  // Result step button visibility (all enabled by default)
  const resultButtons = config?.buttons || {};
  const showAddToBasket = resultButtons.addToBasket !== false;
  const showFavorite = resultButtons.favorite !== false;
  const showFeedback = resultButtons.feedback !== false;
  const showOriginal = resultButtons.showOriginal !== false;
  const showSaveShare = resultButtons.saveShare !== false;

  // Result step handlers
  const handleAddToBasket = () => {
    // Call callback (works in Shadow DOM / Embed mode)
    config?.callbacks?.onAddToBasket?.(resultImage || '', productId);

    // Dispatch window event (works in Shadow DOM / Embed mode)
    window.dispatchEvent(
      new CustomEvent('getroomly-add-to-cart', {
        detail: {
          productId,
          imageUrl: resultImage,
          productName,
          productPrice: _productPrice,
          product: { id: productId, name: productName, price: _productPrice, category },
        },
      })
    );
  };

  const handleFavorite = () => {
    const newFavoritedState = !isFavorited;
    setIsFavorited(newFavoritedState);

    config?.callbacks?.onFavorite?.(resultImage || '', productId);

    window.dispatchEvent(
      new CustomEvent('getroomly-add-to-wishlist', {
        detail: {
          productId,
          isFavorite: newFavoritedState,
          isCurrentlyWishlisted: !newFavoritedState,
          imageUrl: resultImage,
        },
      })
    );
  };

  const handleLike = () => {
    if (hasSubmittedFeedback) {
      return;
    }
    setHasSubmittedFeedback(true);

    config?.callbacks?.onLike?.(resultImage || '', productId);

    window.dispatchEvent(
      new CustomEvent('getroomly-like', {
        detail: { imageUrl: resultImage, productId },
      })
    );
  };

  const handleDislike = () => {
    if (hasSubmittedFeedback) {
      return;
    }
    setHasSubmittedFeedback(true);

    config?.callbacks?.onDislike?.(resultImage || '', productId);

    window.dispatchEvent(
      new CustomEvent('getroomly-dislike', {
        detail: { imageUrl: resultImage, productId },
      })
    );
  };

  const handleShowOriginal = () => {
    setShowOriginalImage(!showOriginalImage);
    const imageToShow = !showOriginalImage ? uploadedImage : resultImage;
    config?.callbacks?.onShowOriginal?.(imageToShow || '', productId);
  };

  const handleDownloadToDevice = () => {
    const imageToDownload = showOriginalImage ? uploadedImage : resultImage;
    config?.callbacks?.onSaveShare?.(imageToDownload || '', productId);
    const link = document.createElement('a');
    link.download = `${productName}-${showOriginalImage ? 'original' : 'visualization'}.jpg`;
    link.href = imageToDownload || '';
    link.click();
    setSaveShareDropdownOpen(false);
  };

  const handleShareWithFriends = async () => {
    if (!resultImage) {
      return;
    }

    try {
      if (navigator.share) {
        const response = await fetch(resultImage);
        const blob = await response.blob();
        const file = new File([blob], `getroomly-design-${Date.now()}.png`, { type: 'image/png' });

        await navigator.share({
          files: [file],
          title: `${productName} Room Visualization`,
          text: `Check out how the ${productName} looks in a room!`,
        });
        setSaveShareDropdownOpen(false);
        return;
      }
      handleDownloadToDevice();
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        handleDownloadToDevice();
      }
    }
    setSaveShareDropdownOpen(false);
  };

  const renderResultStep = () => {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
        }}
      >
        {/* Container uses explicit pixel dimensions computed from the Gemini
            result and viewport. No aspectRatio/maxHeight — those break on iOS
            Safari inside nested flex. Falls back to a square while loading. */}
        <div
          ref={imageContainerRef}
          style={{
            position: 'relative',
            width: containerSize ? `${containerSize.w}px` : '100%',
            height: containerSize ? `${containerSize.h}px` : 'auto',
            aspectRatio: containerSize ? undefined : '1/1',
            borderRadius: '8px',
            overflow: 'hidden',
            cursor: imageScale > 1 ? 'grab' : 'default',
          }}
        >
          {(resultImage || uploadedImage) && (
            <img
              src={showOriginalImage ? uploadedImage || '' : resultImage || ''}
              alt={showOriginalImage ? t.labelOriginal : t.labelNew}
              onLoad={e => {
                const img = e.currentTarget;
                const label = showOriginalImage ? 'Original' : 'Gemini result';
                console.log(
                  `[DEBUG] <img> onLoad (${label}): naturalSize=${img.naturalWidth}x${img.naturalHeight} ratio=${(img.naturalWidth / img.naturalHeight).toFixed(3)}`
                );
                if (!img.naturalWidth || !img.naturalHeight) {
                  return;
                }

                // Size the container to fit THIS image's natural ratio within
                // the modal — parent width bound, 60dvh height cap.
                const parent = imageContainerRef.current?.parentElement;
                const availableWidth = parent?.clientWidth ?? window.innerWidth;
                const maxHeightPx = Math.round(window.innerHeight * 0.6);
                const ratio = img.naturalWidth / img.naturalHeight;
                let w = availableWidth;
                let h = Math.round(w / ratio);
                if (h > maxHeightPx) {
                  h = maxHeightPx;
                  w = Math.round(h * ratio);
                }
                console.log(`[DEBUG] container computed (${label}): ${w}x${h}`);
                if (showOriginalImage) {
                  setOriginalSize({ w, h });
                } else {
                  setResultSize({ w, h });
                }
              }}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                display: 'block',
                transform: `scale(${imageScale})`,
                transformOrigin: 'center center',
                transition: imageScale === 1 ? 'transform 0.25s ease' : 'none',
                willChange: 'transform',
              }}
            />
          )}

          {/* Design Label */}
          <div
            style={{
              position: 'absolute',
              top: '16px',
              left: '16px',
              background: 'rgba(0, 0, 0, 0.5)',
              color: 'white',
              padding: '8px 12px',
              borderRadius: '16px',
              fontSize: '12px',
              fontWeight: '500',
              backdropFilter: 'blur(4px)',
              zIndex: 10,
            }}
          >
            {showOriginalImage ? t.labelOriginal : t.labelNew}
          </div>

          {/* Favorite Button */}
          {showFavorite && (
            <button
              onClick={handleFavorite}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                height: '44px',
                width: '44px',
                borderRadius: '6px',
                background: 'white',
                border: '1px solid #e5e7eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                zIndex: 10,
                transition: 'all 200ms ease',
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill={isFavorited ? 'var(--getroomly-primary)' : 'none'}
                stroke={isFavorited ? 'var(--getroomly-primary)' : 'currentColor'}
                strokeWidth="2"
              >
                <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
              </svg>
            </button>
          )}

          {/* Like/Dislike Feedback */}
          {showFeedback && !hasSubmittedFeedback && (
            <div
              style={{
                position: 'absolute',
                bottom: '16px',
                right: '16px',
                display: 'flex',
                gap: '8px',
                zIndex: 10,
              }}
            >
              <button
                onClick={handleLike}
                style={{
                  height: '32px',
                  width: '32px',
                  borderRadius: '50%',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  background: 'rgba(255, 255, 255, 0.9)',
                  color: '#16a34a',
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M7 10v12" />
                  <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
                </svg>
              </button>
              <button
                onClick={handleDislike}
                style={{
                  height: '32px',
                  width: '32px',
                  borderRadius: '50%',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  background: 'rgba(255, 255, 255, 0.9)',
                  color: '#dc2626',
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M17 14V2" />
                  <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Result Footer Component (Step 4)
  const renderResultFooter = () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '8px',
        width: '100%',
        margin: '0 auto',
      }}
    >
      {showAddToBasket && (
        <button
          onClick={handleAddToBasket}
          style={{
            width: '100%',
            gap: '8px',
            justifyContent: 'center',
            textAlign: 'center',
            fontWeight: '700',
            height: '44px',
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            border: 'none',
            fontSize: '14px',
            padding: '10px 16px',
            background: 'var(--getroomly-primary)',
            color: 'white',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          }}
        >
          {t.addToBasket}
        </button>
      )}

      {showOriginal && (
        <button
          onClick={handleShowOriginal}
          style={{
            width: '100%',
            gap: '8px',
            justifyContent: 'center',
            textAlign: 'center',
            height: '44px',
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            fontSize: '14px',
            padding: '10px 16px',
            border: '1px solid rgba(176, 143, 106, 0.3)',
            color: 'var(--getroomly-primary)',
            background: 'white',
            fontWeight: '700',
          }}
        >
          {showOriginalImage ? t.showNew : t.showOriginal}
        </button>
      )}

      {showSaveShare && (
        <DropdownMenu.Root open={saveShareDropdownOpen} onOpenChange={setSaveShareDropdownOpen}>
          <DropdownMenu.Trigger asChild>
            <button
              style={{
                width: '100%',
                gap: '8px',
                justifyContent: 'center',
                alignItems: 'center',
                textAlign: 'center',
                height: '44px',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                fontSize: '14px',
                padding: '10px 16px',
                background: 'rgba(147, 163, 178, 0.3)',
                color: '#6b7280',
                fontWeight: '700',
                border: '1px solid transparent',
              }}
            >
              {t.saveShare}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              style={{
                background: 'white',
                borderRadius: '6px',
                padding: '4px',
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                border: '1px solid #e5e7eb',
                minWidth: '180px',
                zIndex: 999999,
              }}
            >
              <DropdownMenu.Item
                onSelect={handleDownloadToDevice}
                style={{
                  padding: '8px 12px',
                  fontSize: '14px',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  outline: 'none',
                }}
              >
                {t.downloadToDevice}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={handleShareWithFriends}
                style={{
                  padding: '8px 12px',
                  fontSize: '14px',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  outline: 'none',
                }}
              >
                {t.shareWithFriends}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}

      <button
        onClick={handleNewPhoto}
        style={{
          width: '100%',
          gap: '8px',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
          height: '44px',
          borderRadius: '6px',
          cursor: 'pointer',
          display: 'flex',
          fontSize: '14px',
          padding: '10px 16px',
          background: 'rgba(147, 163, 178, 0.3)',
          color: '#6b7280',
          fontWeight: '700',
          border: '1px solid transparent',
        }}
      >
        {t.newPhoto}
      </button>
    </div>
  );

  // Processing Footer Component (Step 2)
  const renderProcessingFooter = () => (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        width: '90%',
        margin: '0 auto',
      }}
    >
      {/* Cycling Loading Message */}
      <div
        style={{
          height: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          color: 'var(--getroomly-primary)',
          fontSize: '10px',
          fontWeight: '700',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          textAlign: 'center',
        }}
      >
        {t.loadingMessages[messageIndex]}
      </div>

      {/* Progress Bar */}
      <div
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '4px',
            background: 'color-mix(in srgb, var(--getroomly-primary) 20%, transparent)',
            borderRadius: '2px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              height: '100%',
              background: 'var(--getroomly-primary)',
              boxShadow: '0 0 8px color-mix(in srgb, var(--getroomly-primary) 80%, transparent)',
              width: `${progress}%`,
              transition: 'width 100ms linear',
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginTop: '4px',
            color: 'color-mix(in srgb, var(--getroomly-primary) 70%, transparent)',
            fontWeight: '700',
            fontSize: '10px',
            letterSpacing: '0.1em',
            fontFamily: 'ui-monospace, Consolas, monospace',
          }}
        >
          {Math.floor(progress)}%
        </div>
      </div>
    </div>
  );

  // Terms Footer Component (Step 1)
  const renderTermsFooter = () => (
    <div style={{ textAlign: 'center' }}>
      <button
        onClick={handleOpenTerms}
        style={{
          fontSize: '10px',
          color: 'hsla(20, 8%, 45%, 0.6)',
          textDecoration: 'underline',
          fontStyle: 'italic',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '4px 8px',
          transition: 'color 0.2s ease',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.color = 'hsla(20, 8%, 45%, 0.8)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = 'hsla(20, 8%, 45%, 0.6)';
        }}
      >
        {t.termsLink}
      </button>
    </div>
  );

  // Terms Dialog Component
  const renderTermsDialog = () => {
    if (!showTermsDialog) {
      return null;
    }

    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          zIndex: 10000,
          backdropFilter: 'blur(4px)',
        }}
        onClick={() => setShowTermsDialog(false)}
      >
        {/* Inline styles handle the critical layout (flex column, background,
            shadow). The CSS class adds dvh max-height + mobile margin/radius
            overrides that require two-value fallbacks or media queries. */}
        <div
          className="getroomly-terms-content"
          style={{
            backgroundColor: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            width: '100%',
            // No margin or maxWidth — fills the backdrop edge-to-edge on all
            // screen sizes. The plugin dialog's overflow:hidden + rounded-2xl
            // clips the corners naturally so no dark gutter appears.
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Sticky header — always visible, never scrolls away */}
          <div
            style={{
              padding: '16px 20px',
              flexShrink: 0,
              borderBottom: '1px solid #f3f4f6',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '600', color: '#374151' }}>
              {t.termsTitle}
            </h2>
            <button
              onClick={() => setShowTermsDialog(false)}
              style={{
                background: 'rgba(0, 0, 0, 0.1)',
                border: 'none',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#6b7280',
                fontSize: '16px',
                fontWeight: 'bold',
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>

          {/* Scrollable content — only this section scrolls */}
          <div
            style={{
              flex: '1 1 auto',
              overflow: 'auto',
              padding: '16px 20px',
              fontSize: '14px',
              lineHeight: '1.6',
              color: '#4b5563',
            }}
          >
            <div style={{ marginBottom: '16px' }}>
              <h3
                style={{
                  fontSize: '16px',
                  fontWeight: '600',
                  color: '#374151',
                  marginBottom: '8px',
                }}
              >
                {t.termsSection1Title}
              </h3>
              <p style={{ margin: 0 }}>{t.termsSection1Body}</p>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <h3
                style={{
                  fontSize: '16px',
                  fontWeight: '600',
                  color: '#374151',
                  marginBottom: '8px',
                }}
              >
                {t.termsSection2Title}
              </h3>
              <p style={{ margin: '0 0 8px 0' }}>
                <strong>{t.termsNoPersonalDataTitle}:</strong> {t.termsNoPersonalDataBody}
              </p>
              <p style={{ margin: '0 0 8px 0' }}>
                <strong>{t.termsEphemeralTitle}:</strong> {t.termsEphemeralBody}
              </p>
              <p style={{ margin: 0 }}>
                <strong>{t.termsContinuousTitle}:</strong> {t.termsContinuousBody}
              </p>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <h3
                style={{
                  fontSize: '16px',
                  fontWeight: '600',
                  color: '#374151',
                  marginBottom: '8px',
                }}
              >
                {t.termsSection3Title}
              </h3>
              <p style={{ margin: 0 }}>{t.termsSection3Body}</p>
            </div>

            <div>
              <h3
                style={{
                  fontSize: '16px',
                  fontWeight: '600',
                  color: '#374151',
                  marginBottom: '8px',
                }}
              >
                {t.termsSection4Title}
              </h3>
              <p style={{ margin: 0 }}>{t.termsSection4Body}</p>
            </div>
          </div>

          {/* Sticky footer — always visible, never scrolls away */}
          <div
            style={{
              padding: '12px 20px 16px',
              flexShrink: 0,
              borderTop: '1px solid #f3f4f6',
              textAlign: 'center',
            }}
          >
            <button
              onClick={() => setShowTermsDialog(false)}
              style={{
                backgroundColor: 'var(--getroomly-primary)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                padding: '10px 20px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.filter = 'brightness(0.9)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.filter = 'brightness(1)';
              }}
            >
              {t.termsClose}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Header - Step Titles + Close button */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          padding: '4px var(--getroomly-space-sm)',
          flexShrink: 0,
          gap: '4px',
        }}
      >
        {/* Left spacer balances the close button so the title stays centred */}
        <div style={{ width: '28px', flexShrink: 0 }} />

        <h2
          style={{
            flex: 1,
            textAlign: 'center',
            fontSize: '18px',
            fontWeight: 'bold',
            letterSpacing: '-0.025em',
            margin: '0',
            color: 'rgba(0, 0, 0, 0.8)',
          }}
        >
          {step === 'upload' && t.stepUpload}
          {step === 'processing' && t.stepProcessing}
          {step === 'result' && t.stepResult}
        </h2>

        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              flexShrink: 0,
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(0, 0, 0, 0.06)',
              color: '#374151',
              transition: 'all var(--getroomly-transition-fast)',
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
        )}
      </div>

      {/* Content - Like original content structure */}
      <div
        style={{
          flex: '1 1 auto',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          overflow: 'hidden',
          padding: '0',
          margin: '0 auto',
          position: 'relative',
          minHeight: '0',
          textAlign: 'center',
        }}
      >
        {step === 'upload' && renderUploadStep()}
        {step === 'processing' && renderProcessingStep()}
        {step === 'result' && renderResultStep()}
      </div>

      {/* Footer - Dynamic based on step */}
      <div
        style={{
          padding: '8px var(--getroomly-space-sm) var(--getroomly-space-sm)',
          backgroundColor: '#ffffff',
          flexShrink: 0,
        }}
      >
        {step === 'upload' && renderTermsFooter()}
        {step === 'processing' && renderProcessingFooter()}
        {step === 'result' && renderResultFooter()}
      </div>

      {/* Terms Dialog */}
      {renderTermsDialog()}
    </>
  );
}
