import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import {
  AIGenerationError,
  generateRoomVisualization,
  submitFeedback,
  validateFileSize,
  validateImageFile,
} from '@/services/ai-generation';
import type { EmbedConfig } from '@/types/embed-config';
import { getTranslations } from '@/lib/i18n';
import { convertHeicToJpeg, isHeicFile } from '@/lib/heic';
import { dataUrlToBlob } from '@/lib/data-url';

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
  showSteps = false,
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

  // Backend RenderLog id for the current result — distinct from sessionId,
  // which stays the same across multiple generations in one widget
  // instance. Feedback needs to be attributed to this specific image.
  const [generationId, setGenerationId] = useState<string | null>(null);

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
  const [isFavorited, setIsFavorited] = useState(config?.isFavorite ?? false);
  // 'open' = the two thumb circles are visible on the image, 'thanks' =
  // replaced in place by a confirmation pill for 2200ms, 'gone' = cleared,
  // nothing shown at that position (there's no footer row left to
  // preserve height for -- see renderResultStep's top band). Each timer is
  // keyed to its own ref (feedback vs. download status below) -- a shared
  // setTimeout handle would let one reset cancel/overwrite the other's
  // pending clear.
  const [feedbackState, setFeedbackState] = useState<'open' | 'thanks' | 'gone'>('open');
  const feedbackTimerRef = useRef<number | null>(null);
  // Transient confirmations shown ON the button that triggered them, for
  // 2400ms, then reverted -- replaces an earlier design where a separate
  // status line under the disclaimer carried this instead (empty almost
  // all the time, permanently reserving space for that). Three
  // independent buttons, three independent pieces of state: each can be
  // triggered without affecting the others.
  const [downloadButtonConfirmed, setDownloadButtonConfirmed] = useState(false);
  const downloadButtonTimerRef = useRef<number | null>(null);
  const [addedToBasketVisible, setAddedToBasketVisible] = useState(false);
  const addedToBasketTimerRef = useRef<number | null>(null);
  // 'copied' when handleShareWithFriends's clipboard fallback succeeds,
  // 'downloaded' when even that fails and it falls through to a plain
  // download -- two different confirmations on the SAME button, since
  // "Kopierad" would be a lie if what actually happened was a download.
  const [shareButtonStatus, setShareButtonStatus] = useState<'idle' | 'copied' | 'downloaded'>(
    'idle'
  );
  const shareButtonTimerRef = useRef<number | null>(null);

  // The result image's own maxHeight can't be a plain CSS percentage: its
  // flex ancestor (resultContentRef below) has overflow:hidden + minHeight:0,
  // so flexbox is free to shrink it below the image's natural size whenever
  // the header+footer (whose height varies with language/translated string
  // length and with which optional footer rows are currently showing) leave
  // less than a fixed CSS guess assumes -- verified with Puppeteer: a static
  // `max(calc(55dvh - 200px), 150px)` guess left the image up to ~39px taller
  // than the wrapper's real shrunk box at a 375x568 viewport, and the
  // wrapper's own overflow:hidden silently clipped the excess. Since
  // flex:1 1 auto + minHeight:0 makes resultContentRef's resolved height
  // always converge to the true leftover space (flex-grow fills slack,
  // flex-shrink absorbs a deficit, all the way to 0) regardless of the
  // image's own size, ResizeObserver-measuring that element directly is
  // exact where a CSS formula could only ever approximate. Null until the
  // first observation fires (one frame, typically before first paint) --
  // the CSS formula below is used as the fallback for that instant only.
  const [availableImageHeightPx, setAvailableImageHeightPx] = useState<number | null>(null);
  const resultContentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = resultContentRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        setAvailableImageHeightPx(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  // The photo overlay (Before/After toggle, top-left corner; feedback
  // thumbs, bottom-right corner) used to be a child of imageContainerRef,
  // clipped by its overflow:hidden -- but at short viewports
  // resultContentRef (a SEPARATE overflow:hidden ancestor, with its own
  // independently flex-resolved height) could clip it first, regardless
  // of the image's own size, making the only feedback/Before-After
  // controls genuinely inaccessible. Fixed by rendering the overlay as a
  // sibling of the header/content/footer stack instead (see the JSX
  // below, outside imageContainerRef entirely).
  //
  // overlayAnchor is imageContainerRef's on-screen box, in the SAME
  // coordinate system the overlay's own position:absolute resolves
  // against -- found in review that resultContentRef is itself
  // position:relative (its own div, further down), so it's
  // imageContainerRef's real offsetParent; reading offsetTop/Left
  // directly (an earlier version of this did) silently returns
  // coordinates relative to resultContentRef, not the overlay's own
  // containing block, landing it near the header instead of over the
  // image. getBoundingClientRect gives both elements' positions in the
  // same (viewport) coordinate system regardless of how many positioned
  // ancestors sit in between either of them, so subtracting is correct
  // no matter what resultContentRef (or anything else) does with its own
  // `position`.
  //
  // overlayRef is the chicken-and-egg piece: the overlay's own containing
  // block is only knowable once it has actually mounted (via its own
  // offsetParent), but it only needs to mount at all once a real anchor
  // exists. renderPhotoOverlay mounts it regardless, visually hidden
  // until the first real measurement lands, specifically so this has
  // something to read.
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [overlayAnchor, setOverlayAnchor] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const measureOverlayAnchor = useCallback(() => {
    const imageEl = imageContainerRef.current;
    const overlayEl = overlayRef.current;
    // overlayEl can still be null the very first time this runs:
    // attachImageContainerRef's callback ref fires mid-commit, and can
    // race ahead of the overlay's own (later, plain) ref being assigned
    // -- found in review. Bailing out here (rather than falling back to
    // document.body) leaves overlayAnchor -- and therefore
    // visibility:hidden -- untouched for that one moment; the
    // useLayoutEffect below guarantees a real measurement runs after
    // every commit where the overlay could exist, by which point
    // overlayEl is always populated (React attaches every ref in a
    // commit before running that commit's layout effects). Once
    // overlayEl itself exists, though, a still-missing offsetParent does
    // NOT mean "not really mounted" -- jsdom (unit tests, no real layout
    // engine) never resolves offsetParent correctly even for a
    // genuinely-mounted, correctly-styled element; bailing out on that
    // too made every overlay-related unit test fail (the overlay stayed
    // permanently visibility:hidden, invisible to testing-library's
    // accessible-role queries). document.body there is a harmless
    // fallback either way: in jsdom nothing checks the resulting pixel
    // values, and in a real browser this genuinely shouldn't happen once
    // overlayEl is mounted under the (position:fixed) modal.
    if (!imageEl || !overlayEl) {
      return;
    }
    const containingEl = overlayEl.offsetParent ?? document.body;
    const imageRect = imageEl.getBoundingClientRect();
    const containingRect = containingEl.getBoundingClientRect();
    // getBoundingClientRect() is measured from the containing element's
    // BORDER box, but a position:absolute child's top/left resolve
    // against its PADDING box -- found in review: .getroomly-modal-
    // container (the real containingEl in production) has a 1px border
    // (index.css's .border class), so subtracting containingRect.top/left
    // alone landed the overlay 1px down and right of the image. clientTop/
    // clientLeft give exactly the border width (0 for the document.body
    // fallback, which has none), correcting for it regardless of what
    // border containingEl does or doesn't have.
    const top = imageRect.top - containingRect.top - containingEl.clientTop;
    const left = imageRect.left - containingRect.left - containingEl.clientLeft;
    // The overlay's own box is set to EXACTLY the image's box (top/left/
    // width/height, no insets baked in here -- each control applies its
    // own 14px inset from whichever corner it's anchored to instead, see
    // renderPhotoOverlay). That makes the footer irrelevant to this
    // calculation entirely: since the overlay can never be taller than
    // the image itself, and the image (normal document flow) never
    // overlaps the footer to begin with, the overlay structurally can't
    // either -- no separate footer-distance tracking needed. An earlier
    // version of this DID track footer distance (maxHeightBeforeFooter /
    // maxHeightWithinBounds, plus a dedicated footerRef ResizeObserver
    // and language/button-visibility dependencies to keep it fresh) --
    // removed once the single shared band (both controls sharing one
    // row) was replaced with two independently corner-anchored controls,
    // which made that whole tracking mechanism dead weight.
    setOverlayAnchor({
      top,
      left,
      width: imageRect.width,
      height: imageRect.height,
    });
  }, []);

  // The ResizeObserver on imageContainerRef (attachImageContainerRef)
  // only fires when that element's own SIZE changes -- it wouldn't catch
  // imageContainerRef staying the same size but shifting horizontally
  // (its own centering position depends on the available width of its
  // flex row, not its own size), e.g. an actual window/orientation
  // resize. Cheap enough to just always listen.
  useEffect(() => {
    window.addEventListener('resize', measureOverlayAnchor);
    return () => window.removeEventListener('resize', measureOverlayAnchor);
  }, [measureOverlayAnchor]);

  // Measures the bottom-right corner's real rendered height (whichever of
  // the thumb group / confirmation pill currently occupies it -- see
  // renderPhotoOverlay, they share one stable wrapper specifically so this
  // ref doesn't have to track two different, conditionally-mounted
  // elements). Read by the toggle group (top-left) to cap its own
  // maxHeight so its wrapped text can never grow down far enough to
  // visually overlap the bottom-right corner -- found in review (caught by
  // actually screenshotting the narrowest case, not by the numeric-only
  // checks that missed it): at extreme widths (~84px) the toggle's own
  // wrapped text can reach ~146px tall, comfortably overlapping the thumb
  // group beneath it despite each being individually positioned within its
  // own corner correctly.
  //
  // A STATIC height reservation (e.g. always reserving the thumb group's
  // worst-case 96px) was tried first and rejected: measured directly, the
  // thumb group only needs that much when it's ALSO forced to wrap (narrow
  // widths) -- at normal/wide widths it renders as a single 44px-tall row,
  // and a static 96px+ reservation would clip the toggle's own ordinary
  // single-line case for no reason, on any image that happens to be ~150px
  // tall (the common case, not a rare one). Only a real measurement avoids
  // that: it costs the toggle nothing when the bottom corner is small, and
  // caps it correctly when the bottom corner is large.
  const bottomControlRef = useRef<HTMLDivElement | null>(null);
  const [bottomControlHeight, setBottomControlHeight] = useState<number | null>(null);
  // The effect observing bottomControlRef lives further down, alongside
  // showFeedback's own declaration (it depends on showFeedback -- see
  // that effect's comment for why).

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

  // Bumped on every new file selection (and on New Photo) so an in-flight
  // FileReader read can tell it's been superseded. FileReader callbacks are
  // async, so without this a slow read for a since-replaced file could still
  // land and call setState / handleGenerate for the wrong file.
  const fileReadTokenRef = useRef(0);

  // Plain write in the cleanup (no read of a prior ref value), so a pending
  // read's onload/onerror can tell the component is gone and no-op instead
  // of calling setState after unmount.
  const isMountedRef = useRef(true);
  useEffect(() => {
    // Both entrypoints (main.tsx, shadow-entry.tsx) mount under
    // React.StrictMode, which in dev replays this effect as
    // setup -> cleanup -> setup to surface missing cleanup bugs. Without
    // this assignment, the first (simulated) cleanup would leave the ref
    // false forever, permanently no-oping every isMountedRef.current-gated
    // setState -- including the feedback/download timers below -- in dev.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
      }
      if (downloadButtonTimerRef.current) {
        clearTimeout(downloadButtonTimerRef.current);
      }
      if (addedToBasketTimerRef.current) {
        clearTimeout(addedToBasketTimerRef.current);
      }
      if (shareButtonTimerRef.current) {
        clearTimeout(shareButtonTimerRef.current);
      }
    };
  }, []);

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
      setGenerationId(result.generationId ?? null);
      setStep('result');
      onComplete?.(result.imageUrl);
    } catch (err) {
      console.error('Generation error:', err);
      // The backend's own description (err.message) is internal-facing —
      // written for logs/Slack, in English, regardless of the shopper's
      // market. For error codes with a customer-facing meaning, use the
      // plugin's own localized string (same dictionary as the rest of this
      // component's text) instead. Unknown/unmapped codes still fall back
      // to the backend's description rather than a blank message.
      const errorMsg =
        err instanceof AIGenerationError && err.code === 'quotaExceeded'
          ? t.errorTemporarilyUnavailable
          : err instanceof Error
            ? err.message
            : 'Failed to generate image';

      // Reset to clean upload state — no error shown in the plugin.
      // The host website handles error display via the event / onError callback.
      uploadedImageRef.current = null;
      setUploadedImage(null);
      setResultImage(null);
      setGenerationId(null);
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

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    // Bumped before any async work (HEIC sniff/conversion, then FileReader)
    // so a superseded selection — a newer file chosen, or the component
    // unmounted, while any of it is in flight — can be told apart from the
    // current one and ignored, exactly like the FileReader guard below.
    const token = ++fileReadTokenRef.current;

    // Shared by every failure path below: all are "we couldn't get a usable
    // image out of the file" and must recover the same way — clear the file
    // input so the browser fires onChange again if the user retries the same
    // file (an unchanged input value means no change event), reset out of
    // the processing step if a HEIC conversion attempt had already entered
    // it (a no-op if still on the upload step), and surface the failure to
    // the host.
    const failRead = (errorMsg: string) => {
      uploadedImageRef.current = null;
      setUploadedImage(null);
      setStep('upload');
      setIsGenerating(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      window.dispatchEvent(
        new CustomEvent('getroomly-error', {
          detail: { error: errorMsg, productId, sessionId },
        })
      );
      onError?.(errorMsg);
    };

    // Never trust the extension or declared MIME type for this check — a
    // HEIC photo saved/shared with a .jpeg extension reports
    // file.type === 'image/jpeg' but is still undecodable by this (or any
    // non-Safari) browser, so validateImageFile below would wrongly accept
    // it only for the preview/original image to silently fail to render
    // later. Converting first means the rest of this function never has to
    // know the original file wasn't already a browser-native format.
    let imageFile = file;
    let isHeic: boolean;
    try {
      isHeic = await isHeicFile(file);
    } catch (err) {
      // isHeicFile rejects if the underlying FileReader errors — without
      // this catch, that would throw out of handleFileSelect as an
      // unhandled rejection, since nothing awaits this event handler's
      // returned promise.
      if (!isMountedRef.current || fileReadTokenRef.current !== token) {
        return;
      }
      console.error('[Plugin] HEIC signature check failed:', err);
      failRead('Failed to read image file');
      return;
    }
    // Superseded by a newer selection, or the component unmounted, while the
    // sniff above was in flight — bail out before touching any state, same
    // as every other async step in this function.
    if (!isMountedRef.current || fileReadTokenRef.current !== token) {
      return;
    }

    if (isHeic) {
      const sizeValidation = validateFileSize(file.size);
      if (!sizeValidation.isValid) {
        failRead(sizeValidation.error || 'File too large');
        return;
      }
      // Conversion can take a few seconds — show the processing UI
      // immediately rather than leaving the upload button looking frozen.
      // Deliberately NOT setIsGenerating(true) here: that flag gates the
      // progress-bar timer effect below, and starting it during conversion
      // would let progress visibly climb, then snap back to 0 once
      // handleGenerate (called after conversion + the FileReader read below
      // both succeed) resets it to actually start generation — a jarring
      // backward jump. Progress stays frozen at 0 during conversion
      // instead; the spinner/dark background still show via step alone.
      setProgress(0);
      setMessageIndex(0);
      setStep('processing');
      try {
        imageFile = await convertHeicToJpeg(file);
      } catch (err) {
        if (!isMountedRef.current || fileReadTokenRef.current !== token) {
          return;
        }
        console.error('[Plugin] HEIC conversion failed:', err);
        failRead(t.errorUnsupportedImageFormat);
        return;
      }
      if (!isMountedRef.current || fileReadTokenRef.current !== token) {
        return;
      }
    }

    const validation = validateImageFile(imageFile);
    if (!validation.isValid) {
      const errorMsg = validation.error || 'Invalid file';
      console.error('[Plugin] Validation error:', errorMsg);
      failRead(errorMsg);
      return;
    }

    // A data URL (not a blob: URL) so the "original" preview stays valid for
    // the whole review session — blob: URLs are backed by browser memory and
    // can be silently reclaimed under memory pressure (e.g. a concurrent
    // Google Meet screen share), which broke "Show Original" with no error.
    const reader = new FileReader();
    reader.onload = () => {
      // Superseded by a newer selection, or the component unmounted, while
      // this read was in flight — ignore it.
      if (!isMountedRef.current || fileReadTokenRef.current !== token) {
        return;
      }
      // readAsDataURL always yields a string, but result's declared type is
      // string | ArrayBuffer | null — check rather than blindly cast, so a
      // genuinely unexpected value can't slip into state and handleGenerate.
      if (typeof reader.result !== 'string') {
        console.error('[Plugin] FileReader returned a non-string result:', reader.result);
        failRead('Failed to read image file');
        return;
      }
      const dataUrl = reader.result;
      uploadedImageRef.current = dataUrl;
      setUploadedImage(dataUrl);
      handleGenerate(imageFile);
    };
    reader.onerror = () => {
      if (!isMountedRef.current || fileReadTokenRef.current !== token) {
        return;
      }
      console.error('[Plugin] FileReader error:', reader.error);
      failRead('Failed to read image file');
    };
    reader.readAsDataURL(imageFile);
  };

  const handleNewPhoto = () => {
    // Invalidate any in-flight FileReader read so it can't land after this reset.
    fileReadTokenRef.current++;
    uploadedImageRef.current = null;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    setStep('upload');
    setUploadedImage(null);
    setResultImage(null);
    setGenerationId(null);
    setShowOriginalImage(false);

    // Reset every transient timer so a pending one from the previous
    // result can't fire after this reset and clear confirmation state
    // that belongs to the next photo's own buttons.
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    setFeedbackState('open');
    if (downloadButtonTimerRef.current) {
      clearTimeout(downloadButtonTimerRef.current);
      downloadButtonTimerRef.current = null;
    }
    setDownloadButtonConfirmed(false);
    if (addedToBasketTimerRef.current) {
      clearTimeout(addedToBasketTimerRef.current);
      addedToBasketTimerRef.current = null;
    }
    setAddedToBasketVisible(false);
    if (shareButtonTimerRef.current) {
      clearTimeout(shareButtonTimerRef.current);
      shareButtonTimerRef.current = null;
    }
    setShareButtonStatus('idle');
  };

  const handleOpenTerms = () => {
    setShowTermsDialog(true);
  };

  // Pinch-to-zoom helpers (non-passive listeners required for e.preventDefault())
  const getDistance = useCallback(
    (t1: Touch, t2: Touch) =>
      Math.sqrt(Math.pow(t2.clientX - t1.clientX, 2) + Math.pow(t2.clientY - t1.clientY, 2)),
    []
  );

  // Callback ref, not useEffect + a plain useRef: the image well
  // (imageContainerRef's element) only exists in the DOM during the
  // 'result' step, but a useEffect with a fixed dependency array only
  // runs once, on the component's first mount -- while still in the
  // 'upload' step, before this div exists at all. That meant these
  // listeners were being attached to `null` and never re-attached once
  // the real element mounted: pinch-zoom and double-tap-to-reset-zoom
  // never actually worked. A callback ref runs every time the DOM node
  // itself mounts/unmounts, which is what this needs -- confirmed via
  // debug logging that a plain useRef effect here only ever saw `el` as
  // null. React 19 supports returning a cleanup function directly from a
  // ref callback, mirroring a useEffect's own attach/cleanup shape.
  const attachImageContainerRef = useCallback(
    (el: HTMLDivElement | null) => {
      imageContainerRef.current = el;
      measureOverlayAnchor();
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
          // Belt-and-suspenders guard against any button inside this
          // container registering as a double-tap-to-reset-zoom gesture.
          // The photo overlay (Before/After toggle, feedback thumbs) and
          // the favorite/action-row buttons all live outside
          // imageContainerRef now (see renderPhotoOverlay and the
          // footer), so touches on them never reach this handler via
          // bubbling in the first place -- this only matters for
          // whatever real descendants this container still has.
          const target = e.touches[0].target;
          if (target instanceof Element && target.closest('button')) {
            return;
          }
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

      // Re-measures the overlay's anchor whenever imageContainerRef's own
      // rendered size changes (image maxHeight resolving, aspect ratio,
      // etc.) -- deliberately its own observer rather than piggy-backing
      // on resultContentRef's (above): that one fires in the same tick as
      // the state update that CAUSES this element to resize, before the
      // resulting re-render has actually happened, so reading
      // offsetWidth/Height there would return the stale, pre-resize box.
      let resizeObserver: ResizeObserver | undefined;
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          measureOverlayAnchor();
        });
        resizeObserver.observe(el);
      }

      return () => {
        el.removeEventListener('touchstart', onTouchStart);
        el.removeEventListener('touchmove', onTouchMove);
        el.removeEventListener('touchend', onTouchEnd);
        resizeObserver?.disconnect();
      };
    },
    [getDistance, setImageScale, measureOverlayAnchor]
  );

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
                    ? 'var(--getroomly-primary-deep)'
                    : isCompleted
                      ? 'var(--getroomly-primary-deep)'
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
                    ? 'var(--getroomly-primary-deep)'
                    : isCompleted
                      ? 'var(--getroomly-primary-deep)'
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
            backgroundColor: 'var(--getroomly-primary-tint)', // bg-primary/10 equivalent
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
            backgroundColor: 'var(--getroomly-primary-deep)', // bg-primary, white text needs the AA-safe deep tone
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
            borderBottom: '1px solid var(--getroomly-primary-tint)', // border-b border-primary/10
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
                backgroundColor: 'var(--getroomly-primary-tint)', // bg-primary/10
                color: 'var(--getroomly-primary-deep)', // text-primary, small bold text needs the AA-safe deep tone
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
                backgroundColor: 'var(--getroomly-primary-tint)',
                color: 'var(--getroomly-primary-deep)',
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
                backgroundColor: 'var(--getroomly-primary-tint)',
                color: 'var(--getroomly-primary-deep)',
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
        // Includes HEIC/HEIF (both MIME types and extensions — browsers
        // fall back to extension matching when a HEIC file's reported MIME
        // type is empty or inconsistent, which happens often since these
        // aren't standard web image formats) so a genuinely-named .heic
        // file — the common case straight off an iPhone camera roll, not
        // just a mislabeled .jpeg — is actually selectable via the file
        // picker at all. Without this, handleFileSelect's HEIC handling
        // (isHeicFile()/convertHeicToJpeg()) can never run for that case:
        // the OS file picker filters non-matching files out of the dialog
        // before a selection can even happen.
        accept="image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
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
      {/* Photo stays untouched — no dimming, no scrim. transform:scale(1.04)
          bleeds the blur-reveal's edge pixels outside the visible frame
          (the parent's overflow:hidden clips them) instead of shrinking the
          blur radius, which would weaken the reveal effect.
          Conditional, not src={uploadedImage || ''} — during a HEIC
          conversion, this step is entered (to show the loading UI) before
          uploadedImage is populated (it's only set once the post-conversion
          readAsDataURL completes), so an unconditional empty src would
          render a broken-image icon over the dark background for the
          entire conversion. Omitting the element entirely just shows the
          dark background + spinner overlay, which reads fine as "loading". */}
      {uploadedImage && (
        <img
          src={uploadedImage}
          alt="Room being processed"
          className="getroomly-blur-reveal"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            transform: 'scale(1.04)',
          }}
        />
      )}

      {/* Loading stack — a sibling of the image, not a descendant, so it
          never inherits the image's blur filter. */}
      <div
        style={{
          position: 'absolute',
          inset: '0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 30,
          pointerEvents: 'none',
        }}
      >
        <div className="getroomly-spinner-rot" aria-hidden="true">
          <div className="getroomly-spinner-form" />
        </div>

        {/* Purely decorative flavor text, not a live region: it cycles every
            3s and can run well past that during the creep phase, so
            announcing every change would be chatty. The progressbar below
            carries the actual accessible progress state. */}
        <div
          style={{
            marginTop: '34px',
            fontSize: '12px',
            fontWeight: 600,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: '#ffffff',
            textShadow: '0 1px 3px rgba(0, 0, 0, 0.55)',
            textAlign: 'center',
          }}
        >
          {t.loadingMessages[messageIndex]}
        </div>

        <div
          role="progressbar"
          aria-label={t.loadingProgressLabel}
          // Raw value, matching the visual fill below — flooring this (like
          // the displayed percentage text) would let assistive tech report
          // a stale value (e.g. 0%) while the bar is visibly further along.
          // aria-valuetext gives a clean rounded number for the spoken
          // announcement without sacrificing the numeric value's accuracy.
          aria-valuenow={progress}
          aria-valuetext={`${Math.floor(progress)}%`}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{
            marginTop: '14px',
            width: 'min(340px, 60%)',
            position: 'relative',
            height: '4px',
            background: 'rgba(255, 255, 255, 0.28)',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              height: '100%',
              background: '#00c9a7',
              // Raw (fractional) progress, not Math.floor — progress advances
              // ~0.64 points per 100ms tick, so flooring only changes the
              // rendered width every 1-2 ticks (100-200ms, unevenly), which
              // combined with the 100ms transition below produced a visible
              // stutter: move, pause, move again. The raw value updates
              // every tick, so the transition below has a fresh target every
              // 100ms and the fill reads as continuous motion. aria-valuenow
              // (above) matches this same raw value now too, with
              // aria-valuetext providing the rounded spoken number — only
              // the displayed percentage text stays Math.floor'd, for a
              // clean whole-number readout.
              width: `${progress}%`,
              transition: 'width 100ms linear',
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

  // Depends on `step`, `showFeedback`, AND `feedbackState`: bottomControlRef's
  // wrapper only renders when both `step === 'result'` and `showFeedback`
  // are true (see renderPhotoOverlay's call site), but WHAT'S inside it
  // (thumb group / confirmation pill / nothing, once feedbackState reaches
  // 'gone') changes independently of either. `step`/`showFeedback` alone
  // isn't enough -- found in review: useEmbedConfig re-reads
  // config.buttons on every 'getroomly-open-modal' event without
  // remounting (same mechanism as the config.language case below), so a
  // host toggling feedback on/off while the SAME result stays mounted
  // changes showFeedback without changing step at all. Without
  // showFeedback here too: turning feedback ON would mount an unobserved
  // wrapper (the toggle's collision cap never applies to it); turning it
  // OFF leaves the last-measured height stale in state, potentially
  // clipping the toggle unnecessarily on a later remount. The `!el`
  // branch explicitly clears that stale value instead of just leaving it,
  // so it can't linger past the wrapper's own lifetime.
  //
  // Always takes an immediate real measurement via getBoundingClientRect
  // -- unlike ResizeObserver, this needs no special browser support at
  // all, so it's used as the baseline in EVERY browser, not just a
  // fallback for the ones lacking ResizeObserver. An earlier version used
  // a static 96px guess as that fallback instead (the thumb group's own
  // worst-case wrapped height) -- found in review to be wrong in
  // practice: reserving the WORST case unconditionally clips the toggle's
  // ordinary single-line case on any normal wide image (which only needs
  // 44px, not 96), and never releases the reservation at all once
  // feedbackState reaches 'gone' and the wrapper renders empty (needing
  // 0px, not 96). A real measurement costs nothing extra to get right in
  // either case, so there's no reason to guess. Also closes a smaller
  // pre-existing gap: in browsers WITH ResizeObserver, this used to stay
  // null (no cap at all) for one frame until the observer's first
  // callback -- now correct from the very first synchronous measurement.
  useEffect(() => {
    const el = bottomControlRef.current;
    if (!el) {
      setBottomControlHeight(null);
      return;
    }
    setBottomControlHeight(el.getBoundingClientRect().height);
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        setBottomControlHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [step, showFeedback, feedbackState]);

  // Guaranteed post-commit measurement for the overlay's anchor -- the
  // other triggers (attachImageContainerRef's inline call, the
  // ResizeObserver on imageContainerRef, window resize, the base image's
  // onLoad) all depend on something ELSE changing size or firing at the
  // right moment, which isn't reliable for one real case found in review:
  // overlayRef.current can still be null the very first time
  // attachImageContainerRef's callback ref fires mid-commit, since it can
  // race ahead of the overlay's own (later, plain) ref -- measureOverlayAnchor
  // now bails out rather than falling back to a wrong body-relative
  // measurement, so something has to guarantee a real one happens once
  // refs settle. useLayoutEffect (not useEffect) specifically: runs
  // synchronously after the DOM commits and every ref in it is assigned,
  // but before the browser paints -- exactly what's needed to avoid a
  // visible flash at the wrong position.
  useLayoutEffect(() => {
    measureOverlayAnchor();
  }, [
    step,
    resultImage,
    uploadedImage,
    showOriginal,
    showFeedback,
    downloadButtonConfirmed,
    // Same reason as downloadButtonConfirmed just above: the share
    // button's own confirmation label ("Kopierad ✓" / "Nedladdad ✓") can
    // be longer than "Dela" in some languages, wrapping to a second line
    // within the tertiary row's flex:1 1 0 columns (see tertiaryButtonStyle)
    // -- which grows the row's height (minHeight, not a fixed height,
    // specifically so it CAN grow) and therefore the footer's, the same
    // class of shift downloadButtonConfirmed already covers. Not
    // addedToBasketVisible: that button has a fixed height (54px, doesn't
    // grow with content) so its own label swap can't affect footer height.
    shareButtonStatus,
    // useEmbedConfig re-reads window.GetRoomlyEmbedConfig on every
    // 'getroomly-open-modal' event without remounting the modal (see its
    // own comment) -- a host page can call GetRoomly.open() again for a
    // locale change while this exact component instance stays mounted,
    // changing config.language without changing step/resultImage/etc.
    // That both changes the header's rendered text (which can move
    // imageContainerRef without resizing it, so neither the image
    // observer nor window.resize necessarily fires) and changes the
    // overlay's own translated toggle text, so this needs to be an
    // explicit dependency rather than relying on some other value
    // happening to change at the same time. Found in review.
    config?.language,
    // Same class of gap, found in a later review round, for a DIFFERENT
    // reason than these three flags had back when footer-distance was
    // still tracked here (see measureOverlayAnchor's own comment for why
    // that tracking was removed entirely). .getroomly-modal-container is
    // position:fixed with top:50% + transform:translate(-50%,-50%)
    // (App.tsx) -- it's vertically RE-CENTERED around its own total
    // height. Hiding/showing a footer row (add-to-basket, favorite,
    // save/share) changes the modal's total height, which shifts the
    // modal's rendered top position on the page to keep it centered --
    // and therefore shifts the image's absolute viewport position too,
    // even though the image's OWN size never changes. Neither the image's
    // ResizeObserver (fires on size change only) nor window resize (the
    // window itself hasn't changed) catches a shift like that.
    showAddToBasket,
    showFavorite,
    showSaveShare,
    measureOverlayAnchor,
  ]);

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

    setAddedToBasketVisible(true);
    if (addedToBasketTimerRef.current) {
      clearTimeout(addedToBasketTimerRef.current);
    }
    addedToBasketTimerRef.current = window.setTimeout(() => {
      if (isMountedRef.current) {
        setAddedToBasketVisible(false);
      }
    }, 2400);
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

  // Shared by handleLike/handleDislike: shows the confirmation pill on the
  // image for 2200ms, then clears it, leaving nothing at that position.
  const thankForFeedback = () => {
    setFeedbackState('thanks');
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = window.setTimeout(() => {
      if (isMountedRef.current) {
        setFeedbackState('gone');
      }
    }, 2200);
  };

  const handleLike = () => {
    if (feedbackState !== 'open') {
      return;
    }
    thankForFeedback();

    config?.callbacks?.onLike?.(resultImage || '', productId);

    window.dispatchEvent(
      new CustomEvent('getroomly-like', {
        detail: { imageUrl: resultImage, productId },
      })
    );

    // Fire-and-forget: this is a non-critical signal, a failure here must
    // never disrupt the (already-optimistic) result UI.
    if (generationId) {
      submitFeedback(generationId, 'up', config?.apiKey).catch(err =>
        console.warn('[Plugin] Failed to submit like feedback:', err)
      );
    }
  };

  const handleDislike = () => {
    if (feedbackState !== 'open') {
      return;
    }
    thankForFeedback();

    config?.callbacks?.onDislike?.(resultImage || '', productId);

    window.dispatchEvent(
      new CustomEvent('getroomly-dislike', {
        detail: { imageUrl: resultImage, productId },
      })
    );

    if (generationId) {
      submitFeedback(generationId, 'down', config?.apiKey).catch(err =>
        console.warn('[Plugin] Failed to submit dislike feedback:', err)
      );
    }
  };

  // Före/Efter toggle pill sets a specific side directly (not a blind
  // toggle) -- it's two buttons, not one, so a no-op guard on the already-
  // active side avoids firing onShowOriginal redundantly on a repeat click.
  const handleSetShowOriginal = (showOriginal: boolean) => {
    if (showOriginal === showOriginalImage) {
      return;
    }
    setShowOriginalImage(showOriginal);
    const imageToShow = showOriginal ? uploadedImage : resultImage;
    config?.callbacks?.onShowOriginal?.(imageToShow || '', productId);
  };

  // Core download mechanics + the host-page callback -- shared by the
  // download button's own click handler and the share button's tier-3
  // fallback below. Deliberately does NOT touch either button's own
  // confirmation state: which button shows "Nedladdad ✓" depends on which
  // one the user actually clicked, not on what physically happened.
  const triggerDownload = (imageToDownload: string | null) => {
    config?.callbacks?.onSaveShare?.(imageToDownload || '', productId);
    if (!imageToDownload) {
      return;
    }

    const filename = `${productName}-${showOriginalImage ? 'original' : 'visualization'}.jpg`;
    const link = document.createElement('a');
    link.download = filename;

    // imageToDownload is a `data:` URI (generateRoomVisualization returns
    // the image inline as base64 — see ai-generation.ts), and iOS Safari
    // frequently ignores the `download` attribute on a link pointing at a
    // `data:` URI — it just navigates to/opens the image instead of
    // downloading it, with no error thrown. Converting to a blob: URL
    // fixes that (Safari honors `download` reliably for blob: URLs), but
    // the conversion and the click() must both happen synchronously, with
    // no `await` in between — resuming after an awaited fetch()/blob()
    // runs in a later task on iOS Safari, which can lose the transient
    // user activation the download needs, on the very platform this is
    // fixing. dataUrlToBlob decodes the base64 payload synchronously for
    // exactly that reason. There's deliberately no async fetch-based
    // fallback for a non-data: URL: our own images are always data: URIs,
    // never a real cross-origin URL, and an async conversion would
    // reintroduce the same activation-loss risk for a case that can't
    // currently happen.
    const blob = dataUrlToBlob(imageToDownload);
    if (blob) {
      const blobUrl = URL.createObjectURL(blob);
      link.href = blobUrl;
      link.click();
      // Revoking synchronously can race Safari's actual (async) download
      // start and invalidate the blob before it's read. Deferring to the
      // next macrotask lets the browser begin consuming the blob URL first.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
    } else {
      link.href = imageToDownload;
      link.click();
    }
  };

  const handleDownloadToDevice = () => {
    triggerDownload(showOriginalImage ? uploadedImage : resultImage);

    setDownloadButtonConfirmed(true);
    if (downloadButtonTimerRef.current) {
      clearTimeout(downloadButtonTimerRef.current);
    }
    downloadButtonTimerRef.current = window.setTimeout(() => {
      if (isMountedRef.current) {
        setDownloadButtonConfirmed(false);
      }
    }, 2400);
  };

  // Three-tier chain, tried in order:
  //   1. Native share sheet (most common) -- the menu itself is the
  //      confirmation, the button's own label never changes. Cancelling
  //      the sheet (AbortError) isn't a failure -- it's a deliberate
  //      choice not to share, so nothing falls through from there either.
  //   2. Clipboard -- writes the image as a ClipboardItem, button label
  //      swaps to copiedLabel ("Kopierad ✓") for 2400ms. Silent download
  //      after a "Dela" click was misleading in the old two-tier version:
  //      nothing was actually SHARED, so a file quietly landing in
  //      Downloads didn't match what the user asked for. "Kopierad ✓" is
  //      true and lets them paste the image directly into whatever app
  //      they meant to share it through -- closer to the original intent
  //      than a downloads-folder file.
  //   3. Download -- reuses triggerDownload (the same mechanics the
  //      download button itself uses), but sets THIS button's own status
  //      to 'downloaded' rather than calling handleDownloadToDevice
  //      directly, which would wrongly confirm on the download button
  //      instead of the one actually clicked.
  //
  // Deliberately no custom share sheet with app icons (WhatsApp,
  // Telegram, SMS, ...): the browser already knows which apps the user
  // has installed, we'd only be guessing. Tier 1 already does that job.
  const handleShareWithFriends = async () => {
    if (!resultImage) {
      return;
    }

    const showShareConfirmation = (status: 'copied' | 'downloaded') => {
      setShareButtonStatus(status);
      if (shareButtonTimerRef.current) {
        clearTimeout(shareButtonTimerRef.current);
      }
      shareButtonTimerRef.current = window.setTimeout(() => {
        if (isMountedRef.current) {
          setShareButtonStatus('idle');
        }
      }, 2400);
    };

    if (navigator.share) {
      try {
        const response = await fetch(resultImage);
        const blob = await response.blob();
        const file = new File([blob], `getroomly-design-${Date.now()}.png`, { type: 'image/png' });

        await navigator.share({
          files: [file],
          title: `${productName} Room Visualization`,
          text: `Check out how the ${productName} looks in a room!`,
        });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          // User cancelled the share sheet -- not a failure, don't fall
          // through to the clipboard/download tiers below.
          return;
        }
        // A real failure (share API present but the call itself failed) --
        // fall through to tier 2.
      }
    }

    // Tier 2: clipboard. ClipboardItem is unavailable in some browsers
    // (most notably Firefox, which doesn't support writing images to the
    // clipboard via this API) -- typeof-checked the same way ResizeObserver
    // is elsewhere in this file, rather than assuming support.
    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        const response = await fetch(resultImage);
        const blob = await response.blob();
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        showShareConfirmation('copied');
        return;
      }
    } catch {
      // Clipboard write failed (unsupported MIME type, permission denied,
      // document not focused, ...) -- fall through to tier 3 below,
      // regardless of the specific reason.
    }

    // Tier 3: download.
    triggerDownload(showOriginalImage ? uploadedImage : resultImage);
    showShareConfirmation('downloaded');
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
        {/* Wrapper is display:inline-block so it shrinks to the base image's
            actual rendered dimensions -- deliberately NOT switched to a
            fixed-aspect flex:1 well with objectFit:cover to match the
            design literally: this codebase has a long, hard-won history of
            image-cropping regressions (see git log for
            "objectFit:contain"/"no cropping"/reverts of exactly this kind
            of change), so the sizing mechanism here is intentionally
            unchanged. Overlays (badge, favorite, thumbs, toggle pill)
            positioned absolute against this wrapper are guaranteed to sit
            on the image regardless of viewport size or image aspect ratio
            — no JS dimension computation needed. */}
        <div
          ref={attachImageContainerRef}
          style={{
            position: 'relative',
            display: 'inline-block',
            maxWidth: '100%',
            borderRadius: '18px',
            overflow: 'hidden',
            // Design's dark image-well background -- visible in any gap
            // between the image's actual rendered box and its container
            // (there normally isn't one, since the wrapper sizes to the
            // image), and behind the cross-fade transition between layers.
            background: '#221a17',
            cursor: imageScale > 1 ? 'grab' : 'default',
          }}
        >
          {/* Base layer = the AI visualisation ("Efter"). Defines the
              wrapper's actual size via normal flow -- the overlay below is
              absolutely positioned against this box, not the other way
              around, so this is the one layer whose sizing must stay
              exactly as before. */}
          {(resultImage || uploadedImage) && (
            <img
              src={resultImage || uploadedImage || ''}
              alt={t.labelNew}
              aria-hidden={showOriginalImage}
              // Belt-and-suspenders alongside the ResizeObserver on
              // imageContainerRef: that observer only fires once this
              // image has actually decoded and the wrapper's shrink-to-fit
              // box changes size to match -- which it always eventually
              // does, but onLoad re-measures immediately on the load event
              // itself rather than waiting on the observer's own timing,
              // and is the only measurement path left at all in browsers
              // without ResizeObserver support (found in review).
              onLoad={measureOverlayAnchor}
              style={{
                display: 'block',
                maxWidth: '100%',
                // Available space, measured off resultContentRef via
                // ResizeObserver (see its declaration) -- correct regardless
                // of header/footer height, which varies by language and by
                // which optional footer rows are currently showing. A static
                // dvh-based CSS formula was tried first and found to
                // sometimes still leave the image taller than the wrapper's
                // real shrunk box (Puppeteer measured ~39px of clipping at a
                // 375x568 viewport), since the wrapper's overflow:hidden +
                // minHeight:0 lets it shrink independently of any fixed
                // guess.
                //
                // Deliberately NOT padded with extra headroom for the
                // photo overlay (toggle + thumbs) -- an earlier version of
                // this tried that, but it couldn't have worked:
                // resultContentRef is a SEPARATE overflow:hidden ancestor
                // with its own independently flex-resolved height,
                // unaffected by whatever this maxHeight claims, so padding
                // the image taller than what's actually measured just gets
                // clipped by resultContentRef itself. The real fix
                // (renderPhotoOverlay, overlayAnchor) renders the overlay
                // OUTSIDE resultContentRef entirely, as a sibling
                // positioned via measured coordinates -- so it no longer
                // depends on this image's own maxHeight at all. This stays
                // exactly the real available space, nothing more.
                maxHeight: `${availableImageHeightPx ?? 150}px`,
                width: 'auto',
                height: 'auto',
                transform: `scale(${imageScale})`,
                transformOrigin: 'center center',
                transition: imageScale === 1 ? 'transform 0.25s ease' : 'none',
                willChange: 'transform',
              }}
            />
          )}

          {/* Overlay layer = the shopper's original photo ("Före"),
              cross-faded on top of the base layer. objectFit:contain (not
              cover, matching the base layer's own never-crop behavior)
              fills exactly the box the base image established above --
              uploaded photo and AI result share the same aspect ratio in
              practice (the generation preserves input dimensions), so this
              is normally an exact fit, not a letterboxed one. */}
          {resultImage && uploadedImage && (
            <img
              src={uploadedImage}
              alt={t.labelOriginal}
              aria-hidden={!showOriginalImage}
              style={{
                position: 'absolute',
                inset: 0,
                display: 'block',
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                opacity: showOriginalImage ? 1 : 0,
                // Same pinch/double-tap zoom transform as the base layer --
                // without this, zooming while viewing "Before" had no
                // effect, and switching from a zoomed "After" view briefly
                // showed an unzoomed original mid cross-fade.
                transform: `scale(${imageScale})`,
                transformOrigin: 'center center',
                transition:
                  imageScale === 1
                    ? 'opacity 0.3s ease, transform 0.25s ease'
                    : 'opacity 0.3s ease',
              }}
            />
          )}
        </div>
      </div>
    );
  };

  // Photo overlay -- Före/Efter toggle in the top-left corner, feedback
  // thumbs (or the confirmation pill that replaces them) in the
  // bottom-right corner, both rendered on top of the result image as two
  // INDEPENDENTLY corner-anchored elements, not a shared row. NOT a child
  // of imageContainerRef (see overlayAnchor's declaration for why): a
  // version of this was, and at short viewports resultContentRef -- a
  // SEPARATE overflow:hidden ancestor with its own independently
  // flex-resolved height, uninfluenced by anything set on the image
  // itself -- could clip it before the image's own overflow:hidden ever
  // came into play, making the only feedback/Before-After controls
  // genuinely inaccessible. This renders as a sibling of the
  // header/content/footer stack instead, positioned with overlayAnchor
  // (imageContainerRef's own on-screen box, kept in sync via
  // ResizeObserver) and sized to EXACTLY match the image -- see
  // measureOverlayAnchor's comment for why that makes the footer
  // irrelevant here.
  //
  // Replaces the old status badge: the badge duplicated what the toggle's
  // own fill + text + aria-pressed already say, so it's removed rather
  // than moved to another corner -- a deliberate content decision (see
  // ANDRING-5b-bildkontroller.md), not an accident of the toggle moving
  // here.
  //
  // Two independent corners, not one shared flex-wrap row: an earlier
  // version of this put both groups in one top row (justify-content:
  // space-between), which meant they competed for the SAME combined
  // width AND the same shared height budget -- on a narrow portrait photo
  // (measured: an 84px-wide 9:16 crop) both groups wrapped internally at
  // once, and their COMBINED stacked height (~252px measured) blew a
  // ~128px budget so badly that the thumb group ended up entirely
  // invisible, not just clipped. Splitting them into separate corners
  // means each gets the image's FULL width to itself (raising the
  // "doesn't need to wrap at all" threshold from their combined width
  // down to each group's own, much smaller individual width -- the thumb
  // group alone only needs 96px), and each has its own independent
  // height budget measured from its own corner instead of a shared one --
  // converting the worst remaining case (an extremely narrow image) from
  // "one entire group disappears" into "the toggle's own wrapped text
  // clips by a few pixels at the image's edge" (measured: ~10px past the
  // image's own bottom edge in the same 84px-wide case), a meaningfully
  // smaller degradation. Decided directly with the user rather than
  // unilaterally -- see the PR conversation for the full reasoning and
  // the measurements behind it.
  const renderPhotoOverlay = () => {
    if (!((showOriginal || showFeedback) && (resultImage || uploadedImage))) {
      return null;
    }
    // Always mounts once the conditions above are met, regardless of
    // whether a real measurement has landed yet -- overlayRef needs to
    // exist for measureOverlayAnchor's own offsetParent lookup to work at
    // all (see its comment), and visibility:hidden means a transient
    // wrong/zeroed position is never actually visible in the meantime.
    return (
      <div
        ref={overlayRef}
        style={{
          position: 'absolute',
          visibility: overlayAnchor ? 'visible' : 'hidden',
          top: `${overlayAnchor?.top ?? 0}px`,
          left: `${overlayAnchor?.left ?? 0}px`,
          width: `${overlayAnchor?.width ?? 0}px`,
          height: `${overlayAnchor?.height ?? 0}px`,
          overflow: 'hidden',
          zIndex: 10,
          // This box spans the image's full area, including the empty
          // space between the toggle (top-left) and the thumb group
          // (bottom-right) -- without this, that empty space still
          // hit-tests as part of this div (its own box, regardless of
          // visible content), and since the overlay is a DOM SIBLING of
          // imageContainerRef, not a descendant, a touch starting there
          // can never bubble to the pinch/double-tap handlers attached
          // directly to imageContainerRef -- silently losing zoom
          // gestures that start anywhere in that empty space, not just
          // intentionally excluded taps on the controls themselves.
          // 'none' here makes the empty area transparent to hit-testing
          // (falling through to the image beneath); each real control
          // below restores 'auto' so it stays clickable. Found in review.
          pointerEvents: 'none',
        }}
      >
        {showOriginal && resultImage && uploadedImage && (
          <div
            role="group"
            aria-label={t.toggleGroupLabel}
            style={{
              position: 'absolute',
              top: '14px',
              left: '14px',
              display: 'flex',
              flexShrink: 0,
              flexWrap: 'wrap',
              pointerEvents: 'auto',
              // The well is sized to the uploaded photo's own aspect
              // ratio, not the modal width -- a narrow/portrait photo
              // can render a well far narrower than this pill's
              // natural content width. Without a cap, the overlay's own
              // overflow:hidden would silently clip the pill's right
              // side instead of wrapping it. calc(100% - 28px) mirrors
              // the 14px inset on both sides against the overlay's own
              // width, which is exactly the image's width (see
              // measureOverlayAnchor).
              maxWidth: 'calc(100% - 28px)',
              boxSizing: 'border-box',
              gap: '4px',
              padding: '4px',
              borderRadius: '999px',
              background: 'rgba(255, 255, 255, 0.94)',
              backdropFilter: 'blur(12px)',
              boxShadow: '0 6px 18px -6px rgba(0, 0, 0, 0.45)',
              // Caps the toggle's own height so its wrapped text can never
              // grow down far enough to visually overlap the bottom-right
              // corner (thumbs / confirmation pill) -- see
              // bottomControlHeight's own declaration for why this is
              // always a real measurement now, in every browser, not a
              // static guess. undefined (no cap) until both the overlay's
              // real height AND the bottom corner's height are known,
              // matching the same "undefined until measured" convention
              // overlayAnchor itself uses -- true only for the first
              // render, before either effect's initial synchronous
              // measurement lands.
              maxHeight:
                overlayAnchor && bottomControlHeight !== null
                  ? `${Math.max(0, overlayAnchor.height - 14 - bottomControlHeight - 14 - 8)}px`
                  : undefined,
              overflow: 'hidden',
            }}
          >
            <button
              aria-pressed={showOriginalImage}
              onClick={() => handleSetShowOriginal(true)}
              style={{
                border: 0,
                borderRadius: '999px',
                padding: '9px 16px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                background: showOriginalImage ? 'var(--getroomly-primary-deep)' : 'transparent',
                color: showOriginalImage ? '#fff' : '#605d5d',
                transition: 'all 0.2s',
                // Falls back to breaking mid-word only when there's
                // truly no word-boundary room left (e.g. "Nachher" alone
                // on a steeply portrait photo) -- flex-wrap on the row
                // above already handles the normal case (the two
                // buttons dropping to separate lines), this is the one
                // level deeper: fitting a SINGLE button's own text when
                // even that doesn't have room.
                overflowWrap: 'break-word',
                minWidth: 0,
                maxWidth: '100%',
              }}
            >
              {t.toggleBefore}
            </button>
            <button
              aria-pressed={!showOriginalImage}
              onClick={() => handleSetShowOriginal(false)}
              style={{
                border: 0,
                borderRadius: '999px',
                padding: '9px 16px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                background: !showOriginalImage ? 'var(--getroomly-primary-deep)' : 'transparent',
                color: !showOriginalImage ? '#fff' : '#605d5d',
                transition: 'all 0.2s',
                overflowWrap: 'break-word',
                minWidth: 0,
                maxWidth: '100%',
              }}
            >
              {t.toggleAfter}
            </button>
          </div>
        )}

        {/* Stable wrapper for the bottom-right corner -- exists whenever
            showFeedback is true, regardless of which of its two children
            (thumb group / confirmation pill) is currently mounted, so
            bottomControlRef's ResizeObserver has one consistent element to
            observe instead of needing to re-attach across the
            conditionally-mounted children it wraps. Handles the corner
            positioning and width cap; the children below only handle their
            own visual styling. */}
        {showFeedback && (
          <div
            ref={bottomControlRef}
            style={{
              position: 'absolute',
              bottom: '14px',
              right: '14px',
              maxWidth: 'calc(100% - 28px)',
              boxSizing: 'border-box',
            }}
          >
            {feedbackState === 'open' && (
              <div
                role="group"
                aria-label={t.feedbackQuestion}
                style={{
                  display: 'flex',
                  flexShrink: 0,
                  // The two 44px hit targets (96px combined with the gap)
                  // don't shrink, and a steeply portrait photo can render
                  // narrower than that (found in review: a 9:16 crop at
                  // this component's 150px fallback height works out to
                  // ~84px wide, well under 96px). flexWrap here lets the
                  // two buttons stack onto their own lines instead of
                  // overflowing the overlay's left edge and being clipped
                  // by its overflow:hidden -- the same graceful-degradation
                  // approach already used for the toggle pill's own
                  // buttons.
                  flexWrap: 'wrap',
                  gap: '8px',
                  justifyContent: 'flex-end',
                  pointerEvents: 'auto',
                }}
              >
                {/* Two independent circles, not a segmented pill like the
                toggle above -- the pill shape signals "a choice
                between two states, one always active" (the toggle);
                thumbs are two independent one-shot actions, and
                reusing the toggle's shape for a different kind of
                control would teach the wrong affordance. The visible
                circle is 40px (below the 44px touch-target minimum,
                with no room to grow on the image without the
                controls starting to dominate the photo) -- each
                button's own box is 44px so the real hit target meets
                WCAG 2.5.8 without enlarging what's actually drawn. */}
                <button
                  onClick={handleLike}
                  aria-label={t.feedbackLikeLabel}
                  style={{
                    width: '44px',
                    height: '44px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    padding: 0,
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'rgba(255, 255, 255, 0.94)',
                      backdropFilter: 'blur(12px)',
                      boxShadow: '0 6px 18px -6px rgba(0, 0, 0, 0.45)',
                      color: '#201e1d',
                    }}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M7 10v12" />
                      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
                    </svg>
                  </span>
                </button>
                <button
                  onClick={handleDislike}
                  aria-label={t.feedbackDislikeLabel}
                  style={{
                    width: '44px',
                    height: '44px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    padding: 0,
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'rgba(255, 255, 255, 0.94)',
                      backdropFilter: 'blur(12px)',
                      boxShadow: '0 6px 18px -6px rgba(0, 0, 0, 0.45)',
                      color: '#201e1d',
                    }}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M17 14V2" />
                      <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
                    </svg>
                  </span>
                </button>
              </div>
            )}

            {feedbackState === 'thanks' && (
              <div
                style={{
                  flexShrink: 0,
                  // Same reservation as the toggle pill above -- at the
                  // narrowest realistic well (140px, ~112px inside the
                  // overlay's own insets) several languages' feedbackThanks
                  // text is wider than that with no wrap, and the overlay's
                  // own overflow:hidden would silently clip it instead of
                  // wrapping (found in review, verified with Puppeteer: even
                  // English overflowed by ~50px at 140px before this was
                  // added). No whiteSpace:nowrap here, so text wraps within
                  // the pill once constrained.
                  //
                  // maxWidth alone only caps the pill's own BOX -- it
                  // doesn't make the TEXT inside able to wrap. Without
                  // overflow-wrap + minWidth:0 (found in review, verified
                  // with Puppeteer: scrollWidth exceeded clientWidth at an
                  // 84px well, meaning the text was overflowing the pill's
                  // own box even though the box itself measured within
                  // bounds) the text still overflows the constrained box and
                  // gets clipped by the overlay's own overflow:hidden one
                  // level up -- same fix already applied to the toggle
                  // buttons above.
                  minWidth: 0,
                  overflowWrap: 'break-word',
                  boxSizing: 'border-box',
                  fontWeight: 600,
                  fontSize: '11.5px',
                  lineHeight: 1.25,
                  color: '#201e1d',
                  padding: '11px 14px',
                  borderRadius: '999px',
                  background: 'rgba(255, 255, 255, 0.94)',
                  backdropFilter: 'blur(12px)',
                  boxShadow: '0 6px 18px -6px rgba(0, 0, 0, 0.45)',
                }}
              >
                {t.feedbackThanks}
              </div>
            )}
          </div>
        )}

        {/* The thank-you pill above replaces the two circle buttons
            in the DOM rather than updating their text, so unlike a
            persistent status line, there's nothing for assistive
            tech to already be listening to when that swap happens.
            This stays mounted the whole time (text only, visually
            hidden) specifically so the transition gets announced --
            a live region that appears already containing its text
            isn't reliably announced by screen readers, only one
            that already existed and then changed. */}
        {showFeedback && (
          <span
            role="status"
            aria-live="polite"
            style={{
              position: 'absolute',
              width: '1px',
              height: '1px',
              margin: '-1px',
              padding: 0,
              overflow: 'hidden',
              clip: 'rect(0 0 0 0)',
              whiteSpace: 'nowrap',
              border: 0,
            }}
          >
            {feedbackState === 'thanks' ? t.feedbackThanks : ''}
          </span>
        )}
      </div>
    );
  };

  // Result Footer Component (Step 4)
  // Tertiary buttons (download/share/new photo) are flat text buttons in one
  // centred row, not full-width blocks — visually distinct from the primary
  // row above so they read as secondary actions. Auto width, not width:100%.
  const tertiaryButtonStyle: React.CSSProperties = {
    gap: '8px',
    justifyContent: 'center',
    alignItems: 'center',
    textAlign: 'center',
    // minHeight, not a fixed height: at the narrow per-item widths these
    // three buttons share a row on mobile, several languages' longer
    // translations ("Partager avec des amis", "Descargar imagen", ...) wrap
    // to two lines — a fixed height would clip that text. Letting the pill
    // grow keeps the ≥44px touch target (WCAG 2.5.8) without ever clipping.
    minHeight: '44px',
    // flex:1 1 0 + minWidth:0, not the earlier per-button min-width --
    // found in review that min-width only sets a FLOOR, it doesn't cap
    // growth, so a longer confirmation label (e.g. "Nedladdad ✓" swapped
    // in after a download) still grew that one button's own natural width
    // and pushed its siblings sideways. flex:1 1 0 gives all three an
    // EQUAL share of the row instead, determined by the row's own width,
    // not by whichever button's text happens to be longest at that
    // moment -- a language wrapping to a second line now grows that
    // button's HEIGHT (via minHeight above), never its neighbors' widths.
    flex: '1 1 0',
    minWidth: 0,
    borderRadius: '999px',
    cursor: 'pointer',
    display: 'flex',
    fontSize: '14px',
    padding: '10px 16px',
    background: 'none',
    color: '#6b7280',
    fontWeight: '500',
    border: 'none',
  };

  const renderResultFooter = () => (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        width: '100%',
        margin: '0 auto',
      }}
    >
      {/* The feedback question + thumbs now live in a band on the image
          itself, not here -- see renderResultStep and
          ANDRING-5b-bildkontroller.md. Removing this row entirely (not
          just its visible content) is what gives the image its extra
          height; leaving an empty reserved row here would cancel that
          out. */}

      {/* Action row -- favorite moved here from an overlay on the image,
          next to the cart button, matching the design's action row. */}
      {(showFavorite || showAddToBasket) && (
        <div style={{ display: 'flex', gap: '10px' }}>
          {showFavorite && (
            <button
              onClick={handleFavorite}
              aria-label={isFavorited ? t.favoriteLabelActive : t.favoriteLabel}
              aria-pressed={isFavorited}
              style={{
                flexShrink: 0,
                width: '54px',
                height: '54px',
                borderRadius: '999px',
                border: `1.5px solid ${isFavorited ? 'var(--getroomly-primary-deep)' : '#7d7979'}`,
                background: isFavorited ? 'var(--getroomly-primary-tint)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <svg
                width="19"
                height="19"
                viewBox="0 0 24 24"
                fill={isFavorited ? 'var(--getroomly-primary-deep)' : 'none'}
                stroke={isFavorited ? 'var(--getroomly-primary-deep)' : '#201e1d'}
                strokeWidth="2"
              >
                <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
              </svg>
            </button>
          )}
          {showAddToBasket && (
            <button
              onClick={handleAddToBasket}
              style={{
                flex: 1,
                gap: '8px',
                justifyContent: 'center',
                textAlign: 'center',
                fontWeight: '700',
                height: '54px',
                borderRadius: '999px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                border: 'none',
                fontSize: '14px',
                padding: '10px 16px',
                background: 'var(--getroomly-primary-deep)',
                color: 'white',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              }}
            >
              {addedToBasketVisible ? t.addedToBasketLabel : t.addToBasket}
            </button>
          )}
        </div>
      )}
      {/* Visually-hidden, always-mounted (not conditionally rendered) so
          it exists before its text changes -- a live region that mounts
          with its text already set isn't reliably announced, only one
          that already existed and then changed (same reasoning as the
          feedback thumbs' own live region in renderPhotoOverlay). A
          label change on a button that already has focus (the user just
          clicked it) isn't reliably announced by all screen readers on
          its own, so this full-sentence node carries the confirmation
          instead of relying on the visible "Tillagt ✓" swap alone. */}
      {showAddToBasket && (
        <span
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            margin: '-1px',
            padding: 0,
            overflow: 'hidden',
            clip: 'rect(0 0 0 0)',
            whiteSpace: 'nowrap',
            border: 0,
          }}
        >
          {addedToBasketVisible ? t.addedToBasketAnnouncement : ''}
        </span>
      )}

      {/* Permanent measurement-accuracy disclaimer -- never replaced by a
          transient message, and never moved on top of the photo.
          margin-bottom:-4px (not 0) pulls the tertiary row slightly
          closer without touching the gap between any of the OTHER rows
          in this stack (that's controlled by the outer flex column's own
          gap, set once, above). */}
      <p
        style={{
          margin: '0 0 -4px',
          textAlign: 'center',
          fontSize: '12px',
          lineHeight: 1.45,
          color: '#444141',
        }}
      >
        {t.disclaimer}
      </p>

      {/* gap:4px, not the row's earlier 6px -- tightened to match the
          tertiary buttons' own flex:1 1 0 change above (see
          tertiaryButtonStyle): three equal-width columns read better
          slightly closer together than three auto-width buttons did.
          flexWrap is no longer needed here -- flex:1 1 0 + minWidth:0 on
          every button guarantees all three always fit on one row
          (shrinking, never wrapping the ROW itself; a button's own TEXT
          still wraps to a second line internally via tertiaryButtonStyle's
          minHeight when needed). */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '4px' }}>
        {showSaveShare && (
          <>
            <button onClick={handleDownloadToDevice} style={tertiaryButtonStyle}>
              {downloadButtonConfirmed ? t.downloadedLabel : t.downloadToDevice}
            </button>
            <button onClick={handleShareWithFriends} style={tertiaryButtonStyle}>
              {shareButtonStatus === 'copied'
                ? t.copiedLabel
                : shareButtonStatus === 'downloaded'
                  ? t.downloadedLabel
                  : t.shareWithFriends}
            </button>
          </>
        )}
        <button onClick={handleNewPhoto} style={tertiaryButtonStyle}>
          {t.newPhoto}
        </button>
      </div>
    </div>
  );

  // Processing Footer Component (Step 2)
  // Status text + progress bar now live over the image (see
  // renderProcessingStep) — this keeps only the percentage figure, in its
  // existing position/style, per explicit instruction not to move it yet.
  // The footer is intentionally left otherwise empty during load; what (if
  // anything) fills that space is an open design question for later.
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
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          marginTop: '4px',
          // Flat --getroomly-primary-deep, not a transparent mix of the
          // lighter --getroomly-primary: at 70% opacity over the white
          // footer, that effective color measured ~2.5:1 against white --
          // this is real text (the progress percentage), not decoration,
          // and needs the 4.5:1 AA minimum.
          color: 'var(--getroomly-primary-deep)',
          fontWeight: '700',
          fontSize: '10px',
          letterSpacing: '0.1em',
          fontFamily: 'ui-monospace, Consolas, monospace',
        }}
      >
        {Math.floor(progress)}%
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
                <strong>{t.termsLimitedDataCollectionTitle}:</strong>{' '}
                {t.termsLimitedDataCollectionBody}
              </p>
              <p style={{ margin: 0 }}>
                <strong>{t.termsQualityRetentionTitle}:</strong> {t.termsQualityRetentionBody}
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
                backgroundColor: 'var(--getroomly-primary-deep)',
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
        ref={resultContentRef}
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

      {/* Photo overlay (Before/After toggle + feedback thumbs) --
          deliberately NOT nested inside the content wrapper above; see
          renderPhotoOverlay's own comment for why. */}
      {step === 'result' && renderPhotoOverlay()}

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
