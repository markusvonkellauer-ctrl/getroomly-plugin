import React, { useState, useRef, useEffect } from "react";
import { generateRoomVisualization, validateImageFile } from "@/services/ai-generation";
import type { EmbedConfig } from "@/types/embed-config";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

// Professional loading messages (from original frontend)
const LOADING_MESSAGES = [
  "Analysing room geometry...",
  "Detecting ambient light...",
  "Scaling product to floor...",
  "Applying neural textures...",
  "Finalising photorealistic render...",
];

interface RoomVisualizationFlowProps {
  productImages: string[];
  productId: string;
  category: string;
  productName: string;
  productPrice: number;
  measurements?: {
    width: number;
    depth: number;
    height: number;
  };
  showSteps?: boolean;
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
  onComplete,
  onError,
  config,
}: RoomVisualizationFlowProps) {
  const [step, setStep] = useState<"upload" | "mark" | "processing" | "result">("upload");
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [markerPos, setMarkerPos] = useState<{ x: number, y: number }>({ x: 50, y: 75 });
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One sessionId per plugin instance — sent on every generate, indexed in backend RenderLog for support tracing
  const sessionIdRef = useRef<string>(
    (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );

  // Sophisticated loading state
  const [progress, setProgress] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);

  // Result step state
  const [showOriginalImage, setShowOriginalImage] = useState(false);
  const [saveShareDropdownOpen, setSaveShareDropdownOpen] = useState(false);
  const [isFavorited, setIsFavorited] = useState(config?.isFavorite ?? false);
  const [hasSubmittedFeedback, setHasSubmittedFeedback] = useState(false);

  // Sync isFavorited with config changes from host
  useEffect(() => {
    setIsFavorited(config?.isFavorite ?? false);
  }, [config?.isFavorite]);

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
    window.dispatchEvent(new CustomEvent('getroomly-check-favorite', {
      detail: { productId }
    }));
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
    if (step === "processing" && isGenerating) {
      // Reset loading state
      setProgress(0);
      setMessageIndex(0);

      // Progress algorithm: 0→90% in 14s, then 0.2% every 100ms creep forever
      const totalDuration = 14000; // 14 seconds to reach 90%
      const updateInterval = 100;  // Update every 100ms
      const stepIncrement = (90 / (totalDuration / updateInterval));

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
        setMessageIndex(prev => (prev + 1) % LOADING_MESSAGES.length);
      }, 3000);

      // 30s timeout for long loading message
      timeoutTimerRef.current = window.setTimeout(() => {
      }, 30000);
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
  }, [step, isGenerating]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file
    const validation = validateImageFile(file);
    if (!validation.isValid) {
      const errorMsg = validation.error || "Invalid file";
      setError(errorMsg);
      onError?.(errorMsg);
      return;
    }

    setError(null);
    setUploadedFile(file);

    // Revoke previous URL if it exists
    if (uploadedImageRef.current) {
      URL.revokeObjectURL(uploadedImageRef.current);
    }

    // Create preview URL
    const url = URL.createObjectURL(file);
    uploadedImageRef.current = url;
    setUploadedImage(url);
    setStep("mark");
  };

  const handleGenerate = async () => {
    if (!uploadedFile || !uploadedImage) {
      const errorMsg = "Please upload an image first";
      setError(errorMsg);
      onError?.(errorMsg);
      return;
    }

    // Clear any previous errors
    setError(null);
    setIsGenerating(true);
    setStep("processing");

    try {
      // Calculate pixel coordinates from percentage (same logic as original frontend)
      const imgDimensions = await new Promise<{ width: number; height: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.src = uploadedImage;
      });
      const pixelX = Math.round((markerPos.x / 100) * imgDimensions.width);
      const pixelY = Math.round((markerPos.y / 100) * imgDimensions.height);

      console.log('[Plugin] Generating with coordinates:', {
        percentage: { x: markerPos.x, y: markerPos.y },
        pixel: { x: pixelX, y: pixelY },
        imageDimensions: imgDimensions
      });

      const result = await generateRoomVisualization({
        imageBlob: uploadedFile,
        productImage: productImages && productImages.length > 0 ? productImages[0] : '',
        coordinates: {
          x: pixelX,
          y: pixelY,
          percentageX: markerPos.x,
          percentageY: markerPos.y,
        },
        productInfo: {
          name: productName,
          category: category,
          productId: productId,
          measurements: measurements,
        },
        language: 'en',
        apiKey: config?.apiKey,
        sessionId: sessionIdRef.current,
      });

      setResultImage(result.imageUrl);
      setStep("result");
      onComplete?.(result.imageUrl);

    } catch (err) {
      console.error("Generation error:", err);
      const errorMsg = err instanceof Error ? err.message : "Failed to generate image";
      setError(errorMsg);
      setStep("mark"); // Stay on marker step, don't go back to upload
      onError?.(errorMsg);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleNewPhoto = () => {
    // Revoke blob URL to prevent memory leak
    if (uploadedImageRef.current) {
      URL.revokeObjectURL(uploadedImageRef.current);
      uploadedImageRef.current = null;
    }

    setStep("upload");
    setUploadedImage(null);
    setUploadedFile(null);
    setResultImage(null);
    setError(null);
    setMarkerPos({ x: 50, y: 75 });
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

  const renderStepIndicator = (currentStep: "upload" | "mark" | "processing" | "result") => {
    const steps = [
      { key: "upload", label: "Upload", number: 1 },
      { key: "mark", label: "Place Marker", number: 2 },
      { key: "processing", label: "Processing", number: 3 },
      { key: "result", label: "Result", number: 4 }
    ];

    return (
      <div style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        marginBottom: "32px",
        gap: "8px"
      }}>
        {steps.map((stepItem, index) => {
          const isActive = stepItem.key === currentStep;
          const isCompleted = steps.findIndex(s => s.key === currentStep) > index;

          return (
            <div key={stepItem.key} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{
                width: "32px",
                height: "32px",
                borderRadius: "50%",
                backgroundColor: isActive ? "var(--getroomly-primary)" : isCompleted ? "var(--getroomly-primary)" : "var(--getroomly-border-light)",
                color: isActive || isCompleted ? "#ffffff" : "var(--getroomly-muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "14px",
                fontWeight: "600",
                transition: "all 0.3s ease"
              }}>
                {isCompleted ? "✓" : stepItem.number}
              </div>
              <span style={{
                fontSize: "12px",
                color: isActive ? "var(--getroomly-primary)" : isCompleted ? "var(--getroomly-primary)" : "var(--getroomly-muted)",
                fontWeight: isActive ? "600" : "500",
                transition: "all 0.3s ease"
              }}>
                {stepItem.label}
              </span>
              {index < steps.length - 1 && (
                <div style={{
                  width: "24px",
                  height: "2px",
                  backgroundColor: isCompleted ? "var(--getroomly-primary)" : "var(--getroomly-border-light)",
                  margin: "0 8px",
                  transition: "all 0.3s ease"
                }} />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderUploadStep = () => (
    <div style={{
      width: "100%",
      aspectRatio: "5/5",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "24px",
      backgroundColor: "rgba(0, 0, 0, 0.02)",
      borderRadius: "8px",
      position: "relative",
      overflow: "hidden",
      fontFamily: "system-ui, -apple-system, sans-serif",
      textAlign: "center"
    }}>
      {showSteps && renderStepIndicator("upload")}


      {error && (
        <div style={{
          background: "hsl(0, 72%, 96%)",
          color: "hsl(0, 72%, 51%)",
          padding: "12px 16px",
          borderRadius: "0.75rem",
          marginBottom: "24px",
          border: "1px solid hsl(0, 72%, 85%)",
          fontSize: "14px"
        }}>
          {error}
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          marginTop: "8px",
          cursor: "pointer",
          transition: "transform 0.2s ease"
        }}
        onClick={() => fileInputRef.current?.click()}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.05)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
        }}
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) {
            const event = { target: { files: [file] } } as any;
            handleFileSelect(event);
          }
        }}
      >
        <div style={{
          backgroundColor: "hsla(176, 51%, 36%, 0.1)", // bg-primary/10 equivalent
          padding: "16px",
          borderRadius: "50%",
          marginBottom: "12px",
          boxShadow: "inset 0 2px 4px rgba(0, 0, 0, 0.05)" // shadow-inner
        }}>
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
              width: "28px", // h-7 w-7 equivalent
              height: "28px",
              color: "var(--getroomly-primary)" // text-primary
            }}
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" x2="12" y1="3" y2="15"></line>
          </svg>
        </div>
        <button style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          whiteSpace: "nowrap",
          fontSize: "14px",
          backgroundColor: "var(--getroomly-primary)", // bg-primary
          color: "#ffffff", // text-primary-foreground
          border: "none",
          borderRadius: "6px",
          padding: "8px 12px",
          fontWeight: "bold",
          letterSpacing: "0.025em",
          width: "100%",
          maxWidth: "170px",
          boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
          pointerEvents: "none",
          transition: "all 0.2s ease",
          cursor: "pointer"
        }}>
          Upload Photo
        </button>
        <p style={{
          marginTop: "8px",
          fontSize: "9px",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "rgba(107, 114, 126, 0.5)", // text-muted-foreground/50
          fontWeight: "500"
        }}>
          JPEG, PNG • MAX 10MB
        </p>
      </div>

      {/* Guidance Text - matching shadow plugin */}
      <div style={{
        width: "100%",
        maxWidth: "450px",
        margin: "34px auto auto auto",
        padding: "16px", // p-4
        backgroundColor: "hsla(30, 20%, 98%, 0.4)", // bg-background/40
        backdropFilter: "blur(2px)", // backdrop-blur-[2px]
        borderRadius: "8px", // rounded-lg
        border: "1px solid hsla(176, 51%, 36%, 0.05)", // border border-primary/5
        boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)" // shadow-sm
      }}>
        <p style={{
          fontSize: "10px", // text-[10px]
          fontWeight: "bold", // font-bold
          color: "hsla(176, 51%, 36%, 0.8)", // text-primary/80
          marginBottom: "12px", // mb-3
          textTransform: "uppercase", // uppercase
          letterSpacing: "0.15em", // tracking-[0.15em]
          textAlign: "center", // text-center
          borderBottom: "1px solid hsla(176, 51%, 36%, 0.1)", // border-b border-primary/10
          paddingBottom: "8px" // pb-2
        }}>
          For best results:
        </p>

        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px", // space-y-3
          fontSize: "11px", // text-[11px]
          color: "var(--getroomly-muted)", // text-muted-foreground
          lineHeight: "1.3" // leading-snug
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
            <span style={{
              width: "16px", // w-4
              height: "16px", // h-4
              borderRadius: "50%", // rounded-full
              backgroundColor: "hsla(176, 51%, 36%, 0.1)", // bg-primary/10
              color: "var(--getroomly-primary)", // text-primary
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "9px", // text-[9px]
              fontWeight: "bold", // font-bold
              flexShrink: 0 // shrink-0
            }}>1</span>
            <p style={{ margin: 0, textAlign: "left" }}>
              <span style={{ fontWeight: "600", color: "hsla(20, 10%, 15%, 0.8)" }}>Angle & Distance:</span>
              <span> Stand 1–2 metres back and point towards the floor. Capture furniture for scale.</span>
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
            <span style={{
              width: "16px",
              height: "16px",
              borderRadius: "50%",
              backgroundColor: "hsla(176, 51%, 36%, 0.1)",
              color: "var(--getroomly-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "9px",
              fontWeight: "bold",
              flexShrink: 0
            }}>2</span>
            <p style={{ margin: 0, textAlign: "left" }}>
              <span style={{ fontWeight: "600", color: "hsla(20, 10%, 15%, 0.8)" }}>Lighting:</span>
              <span> Ensure the room is well-lit. Avoid deep shadows or dark corners.</span>
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
            <span style={{
              width: "16px",
              height: "16px",
              borderRadius: "50%",
              backgroundColor: "hsla(176, 51%, 36%, 0.1)",
              color: "var(--getroomly-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "9px",
              fontWeight: "bold",
              flexShrink: 0
            }}>3</span>
            <p style={{ margin: 0, textAlign: "left" }}>
              <span style={{ fontWeight: "600", color: "hsla(20, 10%, 15%, 0.8)" }}>Clear Space:</span>
              <span> Remove small clutter from the floor area where the rug will be placed.</span>
            </p>
          </div>
        </div>
      </div>

      {uploadedImage && (
        <div style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#ffffff"
        }}>
          <img
            src={uploadedImage}
            alt="Uploaded room"
            className="object-cover"
            style={{
              width: "100%",
              height: "100%",
              display: "block"
            }}
          />
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        onChange={handleFileSelect}
        style={{ display: "none" }}
      />

    </div>
  );

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xPos = ((e.clientX - rect.left) / rect.width) * 100;
    const yPos = ((e.clientY - rect.top) / rect.height) * 100;
    setMarkerPos({ x: xPos, y: yPos });
  };

  const renderMarkStep = () => (
    <div style={{
      position: "relative",
      width: "100%",
      aspectRatio: "5/5",
      maxHeight: "100%",
      cursor: "crosshair",
      borderRadius: "8px",
      overflow: "hidden",
      backgroundColor: "rgba(0, 0, 0, 0.05)"
    }}>
      <img
        src={uploadedImage || ""}
        alt="Room"
        onClick={handleImageClick}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block"
        }}
      />

      {/* Visual Marker */}
      <div
        style={{
          position: "absolute",
          left: `${markerPos.x}%`,
          top: `${markerPos.y}%`,
          width: "24px",
          height: "24px",
          backgroundColor: "var(--getroomly-primary)",
          borderRadius: "50%",
          border: "2px solid white",
          boxShadow: "0 0 15px hsla(176, 51%, 36%, 0.8)",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
          zIndex: 50,
          transition: "all 0.2s ease"
        }}
      >
        <div style={{
          position: "absolute",
          inset: "0",
          borderRadius: "50%",
          backgroundColor: "hsla(176, 51%, 36%, 0.4)",
          animation: "ping 1s cubic-bezier(0, 0, 0.2, 1) infinite"
        }}></div>
      </div>

      {/* Hover hint */}
      <div style={{
        position: "absolute",
        top: "16px",
        left: "50%",
        transform: "translateX(-50%)",
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        color: "white",
        padding: "8px 16px",
        borderRadius: "20px",
        fontSize: "12px",
        pointerEvents: "none",
        opacity: 0,
        transition: "opacity 0.3s ease",
        zIndex: 50
      }}>
        Click to place marker
      </div>
    </div>
  );

  const renderProcessingStep = () => (
    <div style={{
      position: "relative",
      width: "100%",
      aspectRatio: "5/5",
      maxHeight: "100%",
      background: "#0a111a",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "8px",
      overflow: "hidden"
    }}>
      <img
        src={uploadedImage || ""}
        alt="Room being processed"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
          opacity: progress >= 85 ? 0.9 : 0.4,
          filter: progress >= 85 ? "blur(0px) grayscale(0%)" : "blur(4px) grayscale(60%)",
          transition: "all 1000ms ease"
        }}
      />

      {/* Central Spinner */}
      <div style={{
        position: "absolute",
        inset: "0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        zIndex: 30,
        pointerEvents: "none"
      }}>
        <div style={{
          background: "rgba(0, 0, 0, 0.6)",
          backdropFilter: "blur(12px)",
          borderRadius: "50%",
          padding: "24px",
          boxShadow: "0 0 40px rgba(176, 143, 106, 0.4)",
          border: "1px solid rgba(176, 143, 106, 0.4)"
        }}>
          <div style={{
            width: "48px",
            height: "48px",
            border: "2.5px solid rgba(176, 143, 106, 0.3)",
            borderTop: "2.5px solid #b08f6a",
            borderRadius: "50%",
            animation: "spin 1s linear infinite"
          }} />
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
    window.dispatchEvent(new CustomEvent('getroomly-add-to-cart', {
      detail: {
        productId,
        imageUrl: resultImage,
        productName,
        productPrice: _productPrice,
        product: { id: productId, name: productName, price: _productPrice, category }
      }
    }));
  };

  const handleFavorite = () => {
    const newFavoritedState = !isFavorited;
    setIsFavorited(newFavoritedState);

    config?.callbacks?.onFavorite?.(resultImage || '', productId);

    window.dispatchEvent(new CustomEvent('getroomly-add-to-wishlist', {
      detail: {
        productId,
        isFavorite: newFavoritedState,
        isCurrentlyWishlisted: !newFavoritedState,
        imageUrl: resultImage,
      },
    }));
  };

  const handleLike = () => {
    if (hasSubmittedFeedback) return;
    setHasSubmittedFeedback(true);

    config?.callbacks?.onLike?.(resultImage || '', productId);

    window.dispatchEvent(new CustomEvent('getroomly-like', {
      detail: { imageUrl: resultImage, productId },
    }));
  };

  const handleDislike = () => {
    if (hasSubmittedFeedback) return;
    setHasSubmittedFeedback(true);

    config?.callbacks?.onDislike?.(resultImage || '', productId);

    window.dispatchEvent(new CustomEvent('getroomly-dislike', {
      detail: { imageUrl: resultImage, productId },
    }));
  };

  const handleShowOriginal = () => {
    setShowOriginalImage(!showOriginalImage);
    const imageToShow = !showOriginalImage ? uploadedImage : resultImage;
    config?.callbacks?.onShowOriginal?.(imageToShow || '', productId);
  };

  const handleDownloadToDevice = () => {
    const imageToDownload = showOriginalImage ? uploadedImage : resultImage;
    config?.callbacks?.onSaveShare?.(imageToDownload || '', productId);
    const link = document.createElement("a");
    link.download = `${productName}-${showOriginalImage ? 'original' : 'visualization'}.jpg`;
    link.href = imageToDownload || "";
    link.click();
    setSaveShareDropdownOpen(false);
  };

  const handleShareWithFriends = async () => {
    if (!resultImage) return;

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
      <div style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}>
        {/* Fixed aspect ratio container - prevents resize when toggling images */}
        <div style={{
          position: "relative",
          width: "100%",
          aspectRatio: "5/5",
          maxHeight: "100%",
          borderRadius: "8px",
          overflow: "hidden"
        }}>
        {(resultImage || uploadedImage) && (
          <img
            src={showOriginalImage ? uploadedImage || '' : resultImage || ''}
            alt={showOriginalImage ? "Original Room" : "New Room Design"}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block"
            }}
          />
        )}

        {/* Design Label */}
        <div style={{
          position: "absolute",
          top: "16px",
          left: "16px",
          background: "rgba(0, 0, 0, 0.5)",
          color: "white",
          padding: "8px 12px",
          borderRadius: "16px",
          fontSize: "12px",
          fontWeight: "500",
          backdropFilter: "blur(4px)",
          zIndex: 10
        }}>
          {showOriginalImage ? "Original Room" : "New Design"}
        </div>

        {/* Favorite Button */}
        {showFavorite && (
          <button
            onClick={handleFavorite}
            style={{
              position: "absolute",
              top: "16px",
              right: "16px",
              height: "44px",
              width: "44px",
              borderRadius: "6px",
              background: "white",
              border: "1px solid #e5e7eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              zIndex: 10,
              transition: "all 200ms ease"
            }}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill={isFavorited ? "var(--getroomly-primary)" : "none"}
              stroke={isFavorited ? "var(--getroomly-primary)" : "currentColor"}
              strokeWidth="2">
              <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
            </svg>
          </button>
        )}

        {/* Like/Dislike Feedback */}
        {showFeedback && !hasSubmittedFeedback && (
          <div style={{
            position: "absolute",
            bottom: "16px",
            right: "16px",
            display: "flex",
            gap: "8px",
            zIndex: 10
          }}>
            <button
              onClick={handleLike}
              style={{
                height: "32px",
                width: "32px",
                borderRadius: "50%",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                background: "rgba(255, 255, 255, 0.9)",
                color: "#16a34a"
              }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M7 10v12"/>
                <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>
              </svg>
            </button>
            <button
              onClick={handleDislike}
              style={{
                height: "32px",
                width: "32px",
                borderRadius: "50%",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                background: "rgba(255, 255, 255, 0.9)",
                color: "#dc2626"
              }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 14V2"/>
                <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>
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
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "8px",
      width: "100%",
      margin: "0 auto"
    }}>
      {showAddToBasket && (
        <button
          onClick={handleAddToBasket}
          style={{
            width: "100%",
            gap: "8px",
            justifyContent: "center",
            textAlign: "center",
            fontWeight: "700",
            height: "44px",
            borderRadius: "6px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            border: "none",
            fontSize: "14px",
            padding: "10px 16px",
            background: "var(--getroomly-primary)",
            color: "white",
            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)"
          }}>
          Add to Basket
        </button>
      )}

      {showOriginal && (
        <button
          onClick={handleShowOriginal}
          style={{
            width: "100%",
            gap: "8px",
            justifyContent: "center",
            textAlign: "center",
            height: "44px",
            borderRadius: "6px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            fontSize: "14px",
            padding: "10px 16px",
            border: "1px solid rgba(176, 143, 106, 0.3)",
            color: "var(--getroomly-primary)",
            background: "white",
            fontWeight: "700"
          }}>
          {showOriginalImage ? "Show New Design" : "Show Original"}
        </button>
      )}

      {showSaveShare && (
        <DropdownMenu.Root open={saveShareDropdownOpen} onOpenChange={setSaveShareDropdownOpen}>
          <DropdownMenu.Trigger asChild>
            <button
              style={{
                width: "100%",
                gap: "8px",
                justifyContent: "center",
                alignItems: "center",
                textAlign: "center",
                height: "44px",
                borderRadius: "6px",
                cursor: "pointer",
                display: "flex",
                fontSize: "14px",
                padding: "10px 16px",
                background: "rgba(147, 163, 178, 0.3)",
                color: "#6b7280",
                fontWeight: "700",
                border: "1px solid transparent"
              }}>
              Save / Share
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              style={{
                background: "white",
                borderRadius: "6px",
                padding: "4px",
                boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
                border: "1px solid #e5e7eb",
                minWidth: "180px",
                zIndex: 999999
              }}>
              <DropdownMenu.Item
                onSelect={handleDownloadToDevice}
                style={{ padding: "8px 12px", fontSize: "14px", cursor: "pointer", borderRadius: "4px", outline: "none" }}>
                Download to Device
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={handleShareWithFriends}
                style={{ padding: "8px 12px", fontSize: "14px", cursor: "pointer", borderRadius: "4px", outline: "none" }}>
                Share with Friends
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}

      <button
        onClick={handleNewPhoto}
        style={{
          width: "100%",
          gap: "8px",
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
          height: "44px",
          borderRadius: "6px",
          cursor: "pointer",
          display: "flex",
          fontSize: "14px",
          padding: "10px 16px",
          background: "rgba(147, 163, 178, 0.3)",
          color: "#6b7280",
          fontWeight: "700",
          border: "1px solid transparent"
        }}>
        New Photo
      </button>
    </div>
  );

  // Generate Footer Component (Step 2)
  const renderGenerateFooter = () => (
    <div style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      width: "100%"
    }}>
      <button
        onClick={handleGenerate}
        disabled={isGenerating}
        style={{
          background: isGenerating ? "#f5f5f5" : "var(--getroomly-primary)",
          color: isGenerating ? "#666" : "#ffffff",
          border: "none",
          padding: "16px 32px",
          borderRadius: "8px",
          fontSize: "16px",
          fontWeight: "600",
          cursor: isGenerating ? "not-allowed" : "pointer",
          minWidth: "200px",
          transition: "all 0.2s ease",
          boxShadow: isGenerating ? "none" : "0 4px 12px hsla(176, 51%, 36%, 0.25)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px"
        }}
        onMouseEnter={(e) => {
          if (!isGenerating) {
            e.currentTarget.style.backgroundColor = "hsl(176, 51%, 32%)";
            e.currentTarget.style.transform = "translateY(-2px)";
            e.currentTarget.style.boxShadow = "0 6px 20px hsla(176, 51%, 36%, 0.3)";
          }
        }}
        onMouseLeave={(e) => {
          if (!isGenerating) {
            e.currentTarget.style.backgroundColor = "var(--getroomly-primary)";
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = "0 4px 12px hsla(176, 51%, 36%, 0.25)";
          }
        }}
      >
        {isGenerating ? "Processing..." : "Generate Design"}
      </button>
    </div>
  );

  // Processing Footer Component (Step 3)
  const renderProcessingFooter = () => (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "8px",
      width: "90%",
      margin: "0 auto"
    }}>
      {/* Cycling Loading Message */}
      <div style={{
        height: "16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        color: "#b08f6a",
        fontSize: "10px",
        fontWeight: "700",
        letterSpacing: "0.2em",
        textTransform: "uppercase",
        textAlign: "center"
      }}>
        {LOADING_MESSAGES[messageIndex]}
      </div>

      {/* Progress Bar */}
      <div style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "4px"
      }}>
        <div style={{
          position: "relative",
          width: "100%",
          height: "4px",
          background: "rgba(176, 143, 106, 0.2)",
          borderRadius: "2px",
          overflow: "hidden"
        }}>
          <div style={{
            position: "absolute",
            top: 0,
            left: 0,
            height: "100%",
            background: "#b08f6a",
            boxShadow: "0 0 8px rgba(176, 143, 106, 0.8)",
            width: `${progress}%`,
            transition: "width 100ms linear"
          }} />
        </div>
        <div style={{
          display: "flex",
          justifyContent: "center",
          marginTop: "4px",
          color: "rgba(176, 143, 106, 0.7)",
          fontWeight: "700",
          fontSize: "10px",
          letterSpacing: "0.1em",
          fontFamily: "ui-monospace, Consolas, monospace"
        }}>
          {Math.floor(progress)}%
        </div>
      </div>
    </div>
  );

  // Terms Footer Component (Step 1)
  const renderTermsFooter = () => (
    <div style={{ textAlign: "center" }}>
      <button
        onClick={handleOpenTerms}
        style={{
          fontSize: "10px",
          color: "hsla(20, 8%, 45%, 0.6)",
          textDecoration: "underline",
          fontStyle: "italic",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "4px 8px",
          transition: "color 0.2s ease"
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "hsla(20, 8%, 45%, 0.8)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "hsla(20, 8%, 45%, 0.6)";
        }}
      >
        Terms of Use &amp; Privacy
      </button>
    </div>
  );

  // Terms Dialog Component
  const renderTermsDialog = () => {
    if (!showTermsDialog) return null;

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
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          backdropFilter: 'blur(4px)'
        }}
        onClick={() => setShowTermsDialog(false)}
      >
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            maxWidth: '500px',
            maxHeight: '80vh',
            overflow: 'auto',
            position: 'relative',
            margin: '16px',
            width: '100%',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.2)'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '600', color: '#374151' }}>
                Terms of Use &amp; Privacy
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
                  fontWeight: 'bold'
                }}
              >
                ×
              </button>
            </div>

            <div style={{ fontSize: '14px', lineHeight: '1.6', color: '#4b5563' }}>
              <div style={{ marginBottom: '16px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
                  1. Purpose of Image Processing
                </h3>
                <p style={{ margin: 0 }}>
                  Your uploaded images are processed solely to generate room visualizations with furniture placement.
                  No personal data is collected or stored.
                </p>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
                  2. Data Privacy
                </h3>
                <p style={{ margin: '0 0 8px 0' }}>
                  <strong>No Personal Data:</strong> We only process room images you voluntarily upload.
                </p>
                <p style={{ margin: '0 0 8px 0' }}>
                  <strong>Ephemeral Storage:</strong> Images are temporarily processed and automatically deleted after visualization.
                </p>
                <p style={{ margin: 0 }}>
                  <strong>No Tracking:</strong> We do not store, share, or use your images for any purpose beyond the current visualization.
                </p>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
                  3. Data Security
                </h3>
                <p style={{ margin: 0 }}>
                  All image processing uses secure, encrypted connections. Your images are never permanently stored on our servers.
                </p>
              </div>

              <div>
                <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
                  4. Your Rights
                </h3>
                <p style={{ margin: 0 }}>
                  You retain full ownership of your uploaded images. You can stop using the service at any time,
                  and any temporary data is automatically removed.
                </p>
              </div>
            </div>

            <div style={{ marginTop: '24px', textAlign: 'center' }}>
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
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.filter = 'brightness(0.9)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.filter = 'brightness(1)';
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Header - Step Titles */}
      <div style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        padding: "10px 16px 20px",
        flexShrink: 0
      }}>
        <h2 style={{
          textAlign: "center",
          width: "100%",
          fontSize: "18px",
          fontWeight: "bold",
          letterSpacing: "-0.025em",
          marginTop: "0",
          marginBottom: "0",
          color: "rgba(0, 0, 0, 0.8)"
        }}>
          {step === "upload" && "Step 1: Upload Photo"}
          {step === "mark" && "Step 2: Place Marker"}
          {step === "processing" && "Transforming your space..."}
          {step === "result" && "Review Your New Room"}
        </h2>
      </div>

      {/* Content - Like original content structure */}
      <div style={{
        flex: "1 1 auto",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        overflow: "hidden",
        padding: "0",
        margin: "0 auto",
        position: "relative",
        minHeight: "400px",
        maxHeight: "calc(100vh - 122px)",
        textAlign: "center"
      }}>
        {step === "upload" && renderUploadStep()}
        {step === "mark" && renderMarkStep()}
        {step === "processing" && renderProcessingStep()}
        {step === "result" && renderResultStep()}
      </div>

      {/* Footer - Dynamic based on step */}
      <div style={{
        padding: "10px 0",
        backgroundColor: "#ffffff",
        flexShrink: 0
      }}>
        {step === "upload" && renderTermsFooter()}
        {step === "mark" && renderGenerateFooter()}
        {step === "processing" && renderProcessingFooter()}
        {step === "result" && renderResultFooter()}
      </div>

      {/* Terms Dialog */}
      {renderTermsDialog()}
    </>
  );
}
