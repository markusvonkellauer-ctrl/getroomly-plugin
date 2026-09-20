/**
 * RoomVisualizationFlow Component Tests
 *
 * Covers the new coordinate-free upload → processing → result flow.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoomVisualizationFlow } from '../../src/components/RoomVisualizationFlow';
import { translations } from '../../src/lib/i18n';

jest.mock('../../src/services/ai-generation', () => ({
  // AIGenerationError is the real class, not mocked — the component checks
  // `err instanceof AIGenerationError` in its catch block, which throws
  // ("Right-hand side of 'instanceof' is not an object") if this export
  // were left undefined by only listing the three functions below.
  ...jest.requireActual('../../src/services/ai-generation'),
  generateRoomVisualization: jest.fn(),
  submitFeedback: jest.fn(),
  validateImageFile: jest.fn(() => ({ isValid: true, error: null })),
}));

import {
  generateRoomVisualization,
  submitFeedback,
  validateImageFile,
} from '../../src/services/ai-generation';

const mockHeicTo = jest.fn();
jest.mock('heic-to/csp', () => ({ heicTo: (...args) => mockHeicTo(...args) }));

global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = jest.fn();

const defaultProps = {
  productImages: ['https://example.com/product.jpg'],
  productId: 'rug-001',
  category: 'Carpet',
  productName: 'Test Rug',
  productPrice: 999,
  measurements: { width: 200, depth: 300, height: 1 },
  showSteps: false,
};

const makeFile = () => new File(['img'], 'room.jpg', { type: 'image/jpeg' });

const uploadFile = (input, file) => {
  Object.defineProperty(input, 'files', { value: [file], writable: false, configurable: true });
  fireEvent.change(input);
};

// Parses the numeric r/g/b/a channels out of a computed color string instead
// of comparing strings directly — getComputedStyle can normalize to
// different formats (e.g. legacy 'rgba(0, 0, 0, 0.6)' vs modern
// 'rgb(0 0 0 / 0.6)'), which a strict string match would be brittle against.
const isColor = (colorString, [r, g, b, a]) => {
  const match = colorString.match(/rgba?\(([^)]+)\)/);
  if (!match) return false;
  const channels = match[1].split(/[\s,/]+/).map(Number);
  const [cr, cg, cb, ca = 1] = channels;
  return cr === r && cg === g && cb === b && Math.abs(ca - a) < 0.001;
};

// Walks up from an element looking for the photo overlay -- identified by
// its real inline styles, not a selector or test id, since the component
// has none. The overlay renders outside imageContainerRef (see
// renderPhotoOverlay's comment in RoomVisualizationFlow.tsx --
// resultContentRef could clip it at short viewports otherwise),
// positioned via overlayAnchor with its top/left/width/height matching
// the image exactly -- those are dynamic pixel values, not a fixed
// fingerprint, so unlike the old shared-band version of this helper, this
// identifies the overlay via its STATIC styles instead: position:absolute
// + zIndex:10 + pointerEvents:'none' together are unique in this
// component (zIndex:10 appears nowhere else; see a `grep -n zIndex` on
// the source file). Shared at module scope since both the "photo
// overlay" and "feedback buttons" describe blocks need it.
const findOverlayAncestor = el => {
  let node = el.parentElement;
  while (node) {
    if (
      node.style.position === 'absolute' &&
      node.style.zIndex === '10' &&
      node.style.pointerEvents === 'none'
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
};

describe('RoomVisualizationFlow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    validateImageFile.mockReturnValue({ isValid: true, error: null });
    submitFeedback.mockResolvedValue(undefined);
  });

  // ─── Initial render ───────────────────────────────────────────────────────

  test('renders the upload step on mount', () => {
    render(<RoomVisualizationFlow {...defaultProps} />);
    expect(screen.getByRole('heading', { name: 'Upload Photo' })).toBeInTheDocument();
    expect(screen.queryByText('Step 2: Place Marker')).not.toBeInTheDocument();
  });

  test('shows an upload button', () => {
    render(<RoomVisualizationFlow {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Upload Photo' })).toBeInTheDocument();
  });

  test('the upload step root sets no inline fontFamily, so it can inherit a brand override', () => {
    // Found in review: an inline fontFamily here always beat brand.ts's
    // font-family:inherit override (inline styles win over any injected
    // <style> rule regardless of selector specificity), so the whole
    // upload step silently kept the system font stack on a branded page
    // while every other step correctly inherited the host's own font.
    const { container } = render(<RoomVisualizationFlow {...defaultProps} />);
    const uploadStepRoot = container.querySelector('.getroomly-upload-step');
    expect(uploadStepRoot).not.toBeNull();
    expect(uploadStepRoot.style.fontFamily).toBe('');
  });

  // ─── Upload → Processing (no mark step) ──────────────────────────────────

  test('goes directly to processing after file upload — no mark step', async () => {
    // Never-resolving promise keeps the component in processing state so we can assert it
    generateRoomVisualization.mockReturnValueOnce(new Promise(() => {}));

    render(<RoomVisualizationFlow {...defaultProps} />);
    const input = document.querySelector('input[type="file"]');

    act(() => {
      uploadFile(input, makeFile());
    });

    await waitFor(() => {
      expect(screen.queryByText('Step 2: Place Marker')).not.toBeInTheDocument();
      expect(screen.getByText('Transforming your space...')).toBeInTheDocument();
    });
  });

  test('calls generateRoomVisualization immediately on file selection', async () => {
    generateRoomVisualization.mockReturnValueOnce(new Promise(() => {}));

    render(<RoomVisualizationFlow {...defaultProps} />);

    act(() => {
      uploadFile(document.querySelector('input[type="file"]'), makeFile());
    });

    await waitFor(() => {
      expect(generateRoomVisualization).toHaveBeenCalledTimes(1);
    });
  });

  test('does NOT pass coordinates to generateRoomVisualization', async () => {
    generateRoomVisualization.mockReturnValueOnce(new Promise(() => {}));

    render(<RoomVisualizationFlow {...defaultProps} />);

    act(() => {
      uploadFile(document.querySelector('input[type="file"]'), makeFile());
    });

    await waitFor(() => expect(generateRoomVisualization).toHaveBeenCalledTimes(1));
    const callArg = generateRoomVisualization.mock.calls[0][0];
    expect(callArg).not.toHaveProperty('coordinates');
  });

  // ─── Processing step — loading UI overlay ──────────────────────────────────

  test('renders the morphing spinner form with no dark circle behind it', async () => {
    generateRoomVisualization.mockReturnValueOnce(new Promise(() => {}));

    render(<RoomVisualizationFlow {...defaultProps} />);
    act(() => {
      uploadFile(document.querySelector('input[type="file"]'), makeFile());
    });

    let overlay;
    await waitFor(() => {
      const spinner = document.querySelector('.getroomly-spinner-rot');
      expect(spinner).not.toBeNull();
      expect(document.querySelector('.getroomly-spinner-form')).toBeInTheDocument();
      overlay = spinner.parentElement;
    });
    // Regression check for the old ring spinner's dark backdrop-blur puck —
    // must not reappear behind the new morphing form. Scoped to the
    // processing overlay's own subtree, not a raw HTML substring match, so
    // this can't false-fail on an unrelated element elsewhere in the
    // document that happens to share the color. Uses getComputedStyle
    // (not el.style) and scans every element, not just <div>s, so it also
    // catches the puck if it's reintroduced via a CSS class or on a
    // differently-tagged element instead of an inline style. Includes the
    // overlay element itself, since querySelectorAll only returns
    // descendants.
    const candidates = [overlay, ...Array.from(overlay.querySelectorAll('*'))];
    const darkPuck = candidates.find(el =>
      isColor(window.getComputedStyle(el).backgroundColor, [0, 0, 0, 0.6])
    );
    expect(darkPuck).toBeUndefined();
  });

  test('shows the rotating status message and progress bar over the image, not in the white footer', async () => {
    generateRoomVisualization.mockReturnValueOnce(new Promise(() => {}));

    render(<RoomVisualizationFlow {...defaultProps} />);
    act(() => {
      uploadFile(document.querySelector('input[type="file"]'), makeFile());
    });

    let statusText;
    let spinner;
    await waitFor(() => {
      statusText = screen.getByText(translations.en.loadingMessages[0]);
      spinner = document.querySelector('.getroomly-spinner-rot');
      expect(spinner).not.toBeNull();
    });
    // Status text and spinner share the same overlay-stack parent — sitting
    // over the image, not inside the white footer below it.
    expect(statusText.parentElement).toBe(spinner.parentElement);
  });

  test('the progress bar fill uses raw (fractional) progress for smooth motion, not whole-percent steps', async () => {
    // Regression check: the fill's width previously used Math.floor(progress)
    // to match aria-valuenow/the displayed percentage exactly. Progress
    // advances ~0.64 points per 100ms tick, so flooring only changed the
    // rendered width every 1-2 ticks (100-200ms, unevenly) — combined with
    // the fixed 100ms CSS transition, that read as a stutter (move, pause,
    // move) instead of smooth continuous motion. Polls for a fractional
    // width, since the exact value at any instant depends on real elapsed
    // time.
    generateRoomVisualization.mockReturnValueOnce(new Promise(() => {}));

    render(<RoomVisualizationFlow {...defaultProps} />);
    act(() => {
      uploadFile(document.querySelector('input[type="file"]'), makeFile());
    });

    // findByRole, not a raw CSS selector — reflects how assistive tech
    // actually locates this element (by its accessible role/name).
    const progressbar = await screen.findByRole('progressbar', {
      name: translations.en.loadingProgressLabel,
    });

    await waitFor(() => {
      const fill = progressbar.querySelector('div');
      // Explicit assertion, not a bare property access — a null fill would
      // otherwise throw inside waitFor and surface only as an opaque
      // timeout, not this specific reason.
      expect(fill).not.toBeNull();
      const match = fill.style.width.match(/^([\d.]+)%$/);
      expect(match).not.toBeNull();
      expect(Number.isInteger(Number(match[1]))).toBe(false);
    });
  });

  test('the processing footer shows only the percentage, not a duplicate status message', async () => {
    generateRoomVisualization.mockReturnValueOnce(new Promise(() => {}));

    render(<RoomVisualizationFlow {...defaultProps} />);
    act(() => {
      uploadFile(document.querySelector('input[type="file"]'), makeFile());
    });

    await waitFor(() => {
      expect(screen.getByText(translations.en.loadingMessages[0])).toBeInTheDocument();
    });

    expect(screen.getAllByText(translations.en.loadingMessages[0])).toHaveLength(1);
    // Regex, not a hard-coded '0%' — progress advances on a real 100ms
    // interval, so a slow CI worker could tick past 0 before this runs.
    expect(screen.getByText(/^\d+%$/)).toBeInTheDocument();
  });

  test('applies the progressive blur-reveal class and edge-bleed scale to the processing image', async () => {
    generateRoomVisualization.mockReturnValueOnce(new Promise(() => {}));

    render(<RoomVisualizationFlow {...defaultProps} />);
    act(() => {
      uploadFile(document.querySelector('input[type="file"]'), makeFile());
    });

    await waitFor(() => {
      const img = screen.getByAltText('Room being processed');
      expect(img).toHaveClass('getroomly-blur-reveal');
      expect(img).toHaveStyle({ transform: 'scale(1.04)' });
    });
  });

  // ─── Processing → Result ──────────────────────────────────────────────────

  test('transitions to result step after successful generation', async () => {
    generateRoomVisualization.mockResolvedValueOnce({ imageUrl: 'blob:result' });

    render(<RoomVisualizationFlow {...defaultProps} />);

    await act(async () => {
      uploadFile(document.querySelector('input[type="file"]'), makeFile());
    });

    await waitFor(() => {
      expect(screen.getByText('Review Your New Room')).toBeInTheDocument();
    });
  });

  test('shows the permanent measurement-accuracy disclaimer at the result step', async () => {
    generateRoomVisualization.mockResolvedValueOnce({ imageUrl: 'blob:result' });

    render(<RoomVisualizationFlow {...defaultProps} />);

    await act(async () => {
      uploadFile(document.querySelector('input[type="file"]'), makeFile());
    });

    await waitFor(() => {
      expect(
        screen.getByText('The image is an estimate. Measure at home before you buy.')
      ).toBeInTheDocument();
    });
  });

  test('calls onComplete with the result image URL', async () => {
    generateRoomVisualization.mockResolvedValueOnce({ imageUrl: 'blob:result' });
    const onComplete = jest.fn();

    render(<RoomVisualizationFlow {...defaultProps} onComplete={onComplete} />);

    await act(async () => {
      uploadFile(document.querySelector('input[type="file"]'), makeFile());
    });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith('blob:result');
    });
  });

  // ─── Error handling ───────────────────────────────────────────────────────

  test('returns to upload step on generation failure', async () => {
    generateRoomVisualization.mockRejectedValueOnce(new Error('upstream busy'));

    render(<RoomVisualizationFlow {...defaultProps} />);

    await act(async () => {
      uploadFile(document.querySelector('input[type="file"]'), makeFile());
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Upload Photo' })).toBeInTheDocument();
    });
  });

  test('clears the file input on generation failure so the same file can be retried', async () => {
    generateRoomVisualization.mockRejectedValueOnce(new Error('upstream busy'));

    render(<RoomVisualizationFlow {...defaultProps} />);
    const input = document.querySelector('input[type="file"]');

    await act(async () => {
      uploadFile(input, makeFile());
    });

    await waitFor(() => screen.getByRole('heading', { name: 'Upload Photo' }));
    expect(input.value).toBe('');
  });

  test('calls onError with the error message on failure', async () => {
    generateRoomVisualization.mockRejectedValueOnce(new Error('upstream busy'));
    const onError = jest.fn();

    render(<RoomVisualizationFlow {...defaultProps} onError={onError} />);

    await act(async () => {
      uploadFile(document.querySelector('input[type="file"]'), makeFile());
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('upstream busy');
    });
  });

  test('calls onError with a localized, customer-friendly message for a quota-exceeded failure', async () => {
    // The backend's own description for this error code is internal-facing
    // (English, references "quota") — the plugin substitutes its own
    // localized, generic string instead, since "quota" has no meaning to
    // the shopper who ends up seeing this message on the host's site.
    const { AIGenerationError } = jest.requireActual('../../src/services/ai-generation');
    generateRoomVisualization.mockRejectedValueOnce(
      new AIGenerationError('Monthly render quota exceeded', 'quotaExceeded', 429)
    );
    const onError = jest.fn();

    render(<RoomVisualizationFlow {...defaultProps} onError={onError} />);

    await act(async () => {
      uploadFile(document.querySelector('input[type="file"]'), makeFile());
    });

    await waitFor(() => {
      // Asserted against the translation dictionary itself, not a
      // hard-coded copy of the English string — this stays correct if the
      // wording in en.ts ever changes, rather than needing a manual,
      // easy-to-forget update here to match.
      expect(onError).toHaveBeenCalledWith(translations.en.errorTemporarilyUnavailable);
    });
  });

  test('the file input accepts HEIC/HEIF, so a genuinely-named .heic file is selectable at all', () => {
    // Regression coverage for a Copilot review finding on PR #92: without
    // HEIC/HEIF in `accept`, the OS file picker filters real .heic/.heif
    // files out of the dialog before a selection can even happen — the new
    // isHeicFile()/convertHeicToJpeg() handling could only ever be reached
    // by a *mislabeled* file (e.g. HEIC bytes named photo.jpeg), never a
    // genuinely-named one, which is the common case straight off an
    // iPhone camera roll.
    render(<RoomVisualizationFlow {...defaultProps} />);

    const input = document.querySelector('input[type="file"]');
    // Explicit assertion, not a bare property access — a null input would
    // otherwise throw a TypeError on .getAttribute, a less helpful failure
    // than a clear "expected not null" assertion message.
    expect(input).not.toBeNull();
    const accept = input.getAttribute('accept');
    // Same reasoning as the input itself: a null accept would otherwise
    // fail the toContain matchers with a less clear error than an explicit
    // "expected not null" assertion pointing at the missing attribute.
    expect(accept).not.toBeNull();
    expect(accept).toContain('image/heic');
    expect(accept).toContain('image/heif');
    expect(accept).toContain('.heic');
    expect(accept).toContain('.heif');
  });

  test('rejects invalid file type and stays on upload step', async () => {
    validateImageFile.mockReturnValueOnce({ isValid: false, error: 'Invalid file format.' });

    render(<RoomVisualizationFlow {...defaultProps} />);

    await act(async () => {
      uploadFile(
        document.querySelector('input[type="file"]'),
        new File(['x'], 'doc.pdf', { type: 'application/pdf' })
      );
    });

    expect(generateRoomVisualization).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Upload Photo' })).toBeInTheDocument();
  });

  // ─── HEIC detection/conversion ─────────────────────────────────────────────
  // Regression coverage: a HEIC photo (the default iPhone camera format) is
  // often saved/shared with a .jpeg extension without ever being converted —
  // file.type then reports 'image/jpeg', which is why detection here can
  // never rely on the extension or declared MIME type, only the file's real
  // magic bytes (see src/lib/heic.ts's isHeicFile).

  // jsdom's Blob has no .arrayBuffer()/.text()/.stream(), and the default
  // global FileReader mock (tests/setup.js) always resolves readAsArrayBuffer
  // with an empty buffer — deliberately, so it never flags any other test's
  // fixture files as HEIC. This local mock instead resolves with a real
  // ftyp+heic signature for the sniff, while still behaving like the default
  // mock for the main readAsDataURL call, so the rest of the upload flow
  // proceeds normally.
  class HeicSignatureFileReader {
    readAsArrayBuffer() {
      const bytes = [
        0,
        0,
        0,
        24,
        ...'ftyp'.split('').map(c => c.charCodeAt(0)),
        ...'heic'.split('').map(c => c.charCodeAt(0)),
      ];
      const buffer = new Uint8Array(bytes).buffer;
      queueMicrotask(() => {
        this.result = buffer;
        this.onload?.();
      });
    }
    readAsDataURL() {
      queueMicrotask(() => {
        this.result = 'data:image/jpeg;base64,mockedBase64';
        this.onload?.();
      });
    }
  }

  test('a HEIC file (even mislabeled with a .jpeg extension) is converted to JPEG before upload', async () => {
    const RealFileReader = global.FileReader;
    global.FileReader = HeicSignatureFileReader;
    mockHeicTo.mockResolvedValue(new Blob(['converted'], { type: 'image/jpeg' }));
    generateRoomVisualization.mockReturnValueOnce(new Promise(() => {}));

    try {
      render(<RoomVisualizationFlow {...defaultProps} />);
      // Named .jpeg, like the real report this covers — file.type is
      // 'image/jpeg' despite the bytes actually being HEIC.
      const heicFile = new File(['heic bytes'], 'photo.jpeg', { type: 'image/jpeg' });

      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), heicFile);
      });

      await waitFor(() => expect(generateRoomVisualization).toHaveBeenCalledTimes(1));
      const uploadedBlob = generateRoomVisualization.mock.calls[0][0].imageBlob;
      expect(uploadedBlob).toBeInstanceOf(File);
      expect(uploadedBlob.name).toBe('photo.jpg');
      expect(uploadedBlob.type).toBe('image/jpeg');
      // The converted file, not the original (undecodable) HEIC bytes.
      expect(uploadedBlob).not.toBe(heicFile);
    } finally {
      global.FileReader = RealFileReader;
    }
  });

  test('does not render a broken <img src=""> while a HEIC conversion is still in flight', async () => {
    // Regression coverage for a Copilot review finding on PR #92: the
    // processing step is entered (to show the loading UI) before
    // uploadedImage is populated for a HEIC upload — it's only set once the
    // post-conversion readAsDataURL completes. An unconditional
    // src={uploadedImage || ''} rendered a broken-image icon over the dark
    // background for the entire conversion.
    const RealFileReader = global.FileReader;
    global.FileReader = HeicSignatureFileReader;
    // Never resolves — keeps the component mid-conversion so the DOM can be
    // inspected during that window.
    // mockReturnValueOnce, not mockReturnValue — jest.clearAllMocks() in
    // beforeEach doesn't reset mock implementations, so a persistent
    // default here would leak this never-resolving promise into later
    // tests if file order changes or more HEIC tests are added.
    mockHeicTo.mockReturnValueOnce(new Promise(() => {}));

    try {
      render(<RoomVisualizationFlow {...defaultProps} />);
      const heicFile = new File(['heic bytes'], 'photo.jpeg', { type: 'image/jpeg' });

      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), heicFile);
      });

      await waitFor(() => {
        expect(document.querySelector('.getroomly-spinner-rot')).toBeInTheDocument();
      });
      expect(screen.queryByAltText('Room being processed')).not.toBeInTheDocument();
    } finally {
      global.FileReader = RealFileReader;
    }
  });

  test('progress stays at 0% during HEIC conversion, instead of climbing then jumping back when generation starts', async () => {
    // Regression coverage for a Copilot review finding on PR #92: setting
    // isGenerating to true (alongside step to 'processing') before
    // conversion starts the progress-bar timer effect immediately, letting
    // progress visibly climb during the multi-second conversion — only for
    // handleGenerate to reset it back to 0 once real generation actually
    // begins, a jarring backward jump. isGenerating now stays false until
    // handleGenerate itself sets it, so progress never moves during
    // conversion at all.
    const RealFileReader = global.FileReader;
    global.FileReader = HeicSignatureFileReader;
    mockHeicTo.mockReturnValueOnce(new Promise(() => {}));

    try {
      render(<RoomVisualizationFlow {...defaultProps} />);
      const heicFile = new File(['heic bytes'], 'photo.jpeg', { type: 'image/jpeg' });

      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), heicFile);
      });

      await waitFor(() => {
        expect(document.querySelector('.getroomly-spinner-rot')).toBeInTheDocument();
      });

      // Fake timers only from here, not for the whole test — engaged after
      // the waitFor above (which polls using real timers) has already
      // resolved, to avoid the well-known pain of mixing testing-library's
      // polling with fake timers. The assertion is purely "no timer-driven
      // progress update happens", not about real elapsed time, so
      // advancing fake time past several 100ms ticks is deterministic and
      // instant instead of an actual 350ms sleep.
      jest.useFakeTimers();
      try {
        act(() => {
          jest.advanceTimersByTime(350);
        });
        expect(screen.getByText('0%')).toBeInTheDocument();
      } finally {
        jest.useRealTimers();
      }
    } finally {
      global.FileReader = RealFileReader;
    }
  });

  test('shows a friendly localized error and returns to upload when HEIC conversion fails', async () => {
    const RealFileReader = global.FileReader;
    global.FileReader = HeicSignatureFileReader;
    mockHeicTo.mockRejectedValue(new Error('decode failed'));
    const onError = jest.fn();

    try {
      render(<RoomVisualizationFlow {...defaultProps} onError={onError} />);
      const input = document.querySelector('input[type="file"]');
      const heicFile = new File(['heic bytes'], 'photo.jpeg', { type: 'image/jpeg' });

      await act(async () => {
        uploadFile(input, heicFile);
      });

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(translations.en.errorUnsupportedImageFormat);
      });
      expect(screen.getByRole('heading', { name: 'Upload Photo' })).toBeInTheDocument();
      expect(generateRoomVisualization).not.toHaveBeenCalled();
      // Retrying (a converted file, or a different photo) must fire onChange
      // again — an unchanged input value would silently swallow the retry.
      expect(input.value).toBe('');
    } finally {
      global.FileReader = RealFileReader;
    }
  });

  test('does not attempt HEIC conversion for an ordinary JPEG upload', async () => {
    generateRoomVisualization.mockReturnValueOnce(new Promise(() => {}));

    render(<RoomVisualizationFlow {...defaultProps} />);
    await act(async () => {
      uploadFile(document.querySelector('input[type="file"]'), makeFile());
    });

    await waitFor(() => expect(generateRoomVisualization).toHaveBeenCalledTimes(1));
    expect(mockHeicTo).not.toHaveBeenCalled();
  });

  test('a stale HEIC sniff (superseded by a newer selection before it resolves) does not affect the newer selection', async () => {
    // Regression coverage for a Copilot review finding on PR #90: the async
    // HEIC sniff had no token/isMounted guard before touching state, so a
    // slower-resolving sniff for a since-replaced file could still flip the
    // step back to 'processing' (or report an error) for the wrong file.
    const RealFileReader = global.FileReader;
    const instances = [];
    class ManualSniffFileReader {
      constructor() {
        instances.push(this);
      }
      readAsArrayBuffer() {
        // Left pending — driven manually below, same as the ManualFileReader
        // pattern used elsewhere in this file for the main read.
      }
      readAsDataURL() {
        this.result = 'data:image/jpeg;base64,mockedBase64';
        queueMicrotask(() => this.onload?.());
      }
    }
    global.FileReader = ManualSniffFileReader;
    generateRoomVisualization.mockReturnValueOnce(new Promise(() => {}));

    try {
      render(<RoomVisualizationFlow {...defaultProps} />);
      const input = document.querySelector('input[type="file"]');
      const fileA = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
      const fileB = new File(['b'], 'b.jpg', { type: 'image/jpeg' });

      act(() => uploadFile(input, fileA));
      act(() => uploadFile(input, fileB));

      // fileB's sniff resolves first, as "not HEIC" — its flow proceeds
      // normally.
      await act(async () => {
        instances[1].result = new Uint8Array(12).buffer; // all zeros, not ftyp
        instances[1].onload?.();
      });
      await waitFor(() => expect(generateRoomVisualization).toHaveBeenCalledTimes(1));
      expect(generateRoomVisualization.mock.calls[0][0].imageBlob.name).toBe('b.jpg');

      // The stale fileA sniff resolves afterwards, as HEIC — must be a
      // no-op: it must not trigger a second, competing generate call.
      await act(async () => {
        const heicBytes = [
          0,
          0,
          0,
          24,
          ...'ftyp'.split('').map(c => c.charCodeAt(0)),
          ...'heic'.split('').map(c => c.charCodeAt(0)),
        ];
        instances[0].result = new Uint8Array(heicBytes).buffer;
        instances[0].onload?.();
      });
      expect(generateRoomVisualization).toHaveBeenCalledTimes(1);
    } finally {
      global.FileReader = RealFileReader;
    }
  });

  test('a HEIC signature check failure is caught and reported as a read failure, not an unhandled rejection', async () => {
    // Regression coverage for a Copilot review finding on PR #90:
    // isHeicFile rejects if its FileReader errors, which — uncaught — would
    // throw out of handleFileSelect as an unhandled promise rejection,
    // since nothing awaits this event handler's returned promise.
    const RealFileReader = global.FileReader;
    class ErroringSniffFileReader {
      readAsArrayBuffer() {
        queueMicrotask(() => this.onerror?.(new Event('error')));
      }
    }
    global.FileReader = ErroringSniffFileReader;
    const onError = jest.fn();

    try {
      render(<RoomVisualizationFlow {...defaultProps} onError={onError} />);
      const input = document.querySelector('input[type="file"]');

      await act(async () => {
        uploadFile(input, makeFile());
      });

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith('Failed to read image file');
      });
      expect(screen.getByRole('heading', { name: 'Upload Photo' })).toBeInTheDocument();
      expect(generateRoomVisualization).not.toHaveBeenCalled();
      expect(input.value).toBe('');
    } finally {
      global.FileReader = RealFileReader;
    }
  });

  // ─── Original image survives as a data: URL (not blob:) ──────────────────
  // Regression test: blob: URLs are backed by browser memory and can be
  // silently reclaimed under memory pressure (observed with a concurrent
  // Google Meet screen share), which broke the Before/After toggle with a
  // broken image and no error. The fix reads the file as a data: URL
  // instead.

  test('the Before/After toggle displays the uploaded photo as a data: URL, not blob:', async () => {
    generateRoomVisualization.mockResolvedValueOnce({ imageUrl: 'data:image/webp;base64,result' });

    render(<RoomVisualizationFlow {...defaultProps} />);

    await act(async () => {
      uploadFile(document.querySelector('input[type="file"]'), makeFile());
    });

    await waitFor(() => screen.getByText('Review Your New Room'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Before' }));
    });

    const originalImg = await screen.findByAltText('Original Room');
    expect(originalImg.src).toMatch(/^data:/);
    expect(originalImg.src).not.toMatch(/^blob:/);
  });

  test('reading the uploaded file fails gracefully: stays on upload step, clears the input, and calls onError', async () => {
    const RealFileReader = global.FileReader;
    class FailingFileReader {
      readAsArrayBuffer() {
        this.result = new ArrayBuffer(0);
        queueMicrotask(() => this.onload?.());
      }
      readAsDataURL() {
        queueMicrotask(() => this.onerror?.(new Event('error')));
      }
    }
    global.FileReader = FailingFileReader;
    const onError = jest.fn();

    try {
      render(<RoomVisualizationFlow {...defaultProps} onError={onError} />);
      const input = document.querySelector('input[type="file"]');

      await act(async () => {
        uploadFile(input, makeFile());
      });

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith('Failed to read image file');
      });
      expect(screen.getByRole('heading', { name: 'Upload Photo' })).toBeInTheDocument();
      expect(generateRoomVisualization).not.toHaveBeenCalled();
      // Retrying the same file must fire onChange again — an unchanged input
      // value would silently swallow the retry.
      expect(input.value).toBe('');
    } finally {
      global.FileReader = RealFileReader;
    }
  });

  test('a non-string FileReader.result is treated as a read failure, not silently dropped', async () => {
    const RealFileReader = global.FileReader;
    class NonStringResultFileReader {
      readAsArrayBuffer() {
        this.result = new ArrayBuffer(0);
        queueMicrotask(() => this.onload?.());
      }
      readAsDataURL() {
        this.result = new ArrayBuffer(0); // unexpected — readAsDataURL should yield a string
        queueMicrotask(() => this.onload?.());
      }
    }
    global.FileReader = NonStringResultFileReader;
    const onError = jest.fn();

    try {
      render(<RoomVisualizationFlow {...defaultProps} onError={onError} />);
      const input = document.querySelector('input[type="file"]');

      await act(async () => {
        uploadFile(input, makeFile());
      });

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith('Failed to read image file');
      });
      expect(screen.getByRole('heading', { name: 'Upload Photo' })).toBeInTheDocument();
      expect(generateRoomVisualization).not.toHaveBeenCalled();
      expect(input.value).toBe('');
    } finally {
      global.FileReader = RealFileReader;
    }
  });

  test('a stale FileReader read from a superseded file selection is ignored', async () => {
    const RealFileReader = global.FileReader;
    const instances = [];
    class ManualFileReader {
      constructor() {
        instances.push(this);
      }
      // Auto-resolves the HEIC magic-byte sniff (0 bytes → not HEIC) so this
      // mock only needs to manually drive the *main* read below, same as
      // before that extra internal read was introduced.
      readAsArrayBuffer() {
        this.result = new ArrayBuffer(0);
        queueMicrotask(() => this.onload?.());
      }
      readAsDataURL(file) {
        this.result = `data:image/jpeg;base64,${file.name}`;
      }
    }
    global.FileReader = ManualFileReader;
    generateRoomVisualization.mockResolvedValue({ imageUrl: 'data:image/webp;base64,result' });

    try {
      render(<RoomVisualizationFlow {...defaultProps} />);
      const input = document.querySelector('input[type="file"]');
      const fileA = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
      const fileB = new File(['b'], 'b.jpg', { type: 'image/jpeg' });

      // Two selections in a row before either read resolves — the second
      // supersedes the first (matches a double file-picker/drop in practice).
      // Each selection now constructs two FileReaders (HEIC sniff, then the
      // main read) — an `await act` between them lets the sniff's
      // auto-resolving microtask settle so the main reader actually gets
      // constructed before the next selection fires.
      act(() => uploadFile(input, fileA));
      await act(async () => {});
      act(() => uploadFile(input, fileB));
      await act(async () => {});

      const mainReaderA = instances[1];
      const mainReaderB = instances[3];

      // The stale read (A) resolves first — must be a no-op.
      act(() => mainReaderA.onload?.());
      expect(generateRoomVisualization).not.toHaveBeenCalled();

      // The current read (B) resolves — this one proceeds.
      await act(async () => mainReaderB.onload?.());
      await waitFor(() => expect(generateRoomVisualization).toHaveBeenCalledTimes(1));
      expect(generateRoomVisualization.mock.calls[0][0].imageBlob).toBe(fileB);
    } finally {
      global.FileReader = RealFileReader;
    }
  });

  test('a pending FileReader read is ignored if it resolves after the component unmounts', async () => {
    const RealFileReader = global.FileReader;
    const instances = [];
    class ManualFileReader {
      constructor() {
        instances.push(this);
      }
      readAsArrayBuffer() {
        this.result = new ArrayBuffer(0);
        queueMicrotask(() => this.onload?.());
      }
      readAsDataURL() {
        this.result = 'data:image/jpeg;base64,x';
      }
    }
    global.FileReader = ManualFileReader;
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { unmount } = render(<RoomVisualizationFlow {...defaultProps} />);
      act(() => uploadFile(document.querySelector('input[type="file"]'), makeFile()));
      // Lets the HEIC-sniff microtask resolve, constructing the main reader
      // (instances[1]), before unmounting.
      await act(async () => {});

      unmount();
      act(() => instances[1].onload?.());

      expect(generateRoomVisualization).not.toHaveBeenCalled();
      // React's warning is often split across multiple console.error args
      // (format string + substitutions) — join them all so a match in a
      // later arg isn't missed, which would let this test pass incorrectly.
      const unmountedWarning = errorSpy.mock.calls.some(args =>
        /unmounted component/i.test(args.map(String).join(' '))
      );
      expect(unmountedWarning).toBe(false);
    } finally {
      global.FileReader = RealFileReader;
      errorSpy.mockRestore();
    }
  });

  // ─── New Photo reset ──────────────────────────────────────────────────────

  test('New Photo button resets back to upload step and clears file input', async () => {
    generateRoomVisualization.mockResolvedValueOnce({ imageUrl: 'blob:result' });

    render(<RoomVisualizationFlow {...defaultProps} />);
    const input = document.querySelector('input[type="file"]');

    await act(async () => {
      uploadFile(input, makeFile());
    });

    await waitFor(() => screen.getByText('Review Your New Room'));

    await act(async () => {
      fireEvent.click(screen.getByText('New Photo'));
    });

    expect(screen.getByRole('heading', { name: 'Upload Photo' })).toBeInTheDocument();
    expect(input.value).toBe('');
  });

  // ─── Before/After toggle pill ───────────────────────────────────────────

  describe('Before/After toggle pill', () => {
    const renderAtResult = async (generationResult, props = {}) => {
      generateRoomVisualization.mockResolvedValueOnce(generationResult);
      render(<RoomVisualizationFlow {...defaultProps} {...props} />);
      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), makeFile());
      });
      await waitFor(() => screen.getByText('Review Your New Room'));
    };

    test('starts on "After" (aria-pressed), and switches when "Before" is clicked', async () => {
      const user = userEvent.setup();
      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,result' });

      expect(screen.getByRole('button', { name: 'Before' })).toHaveAttribute(
        'aria-pressed',
        'false'
      );
      expect(screen.getByRole('button', { name: 'After' })).toHaveAttribute('aria-pressed', 'true');

      // The actual cross-fading images, not just the pill's own state --
      // both layers are always mounted, so what matters is which one is
      // visible/hidden, not which exists.
      const afterImg = screen.getByAltText('New Design');
      const beforeImg = screen.getByAltText('Original Room');
      expect(afterImg.src).toBe('data:image/jpeg;base64,result');
      expect(beforeImg.src).toBe('data:image/jpeg;base64,mockedBase64');
      expect(afterImg.style.opacity).toBe('');
      expect(beforeImg.style.opacity).toBe('0');
      expect(afterImg).toHaveAttribute('aria-hidden', 'false');
      expect(beforeImg).toHaveAttribute('aria-hidden', 'true');

      await user.click(screen.getByRole('button', { name: 'Before' }));

      expect(screen.getByRole('button', { name: 'Before' })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(screen.getByRole('button', { name: 'After' })).toHaveAttribute(
        'aria-pressed',
        'false'
      );
      expect(beforeImg.style.opacity).toBe('1');
      expect(afterImg).toHaveAttribute('aria-hidden', 'true');
      expect(beforeImg).toHaveAttribute('aria-hidden', 'false');
    });

    test('calls onShowOriginal with the uploaded photo when switching to Before, and the result image when switching back to After', async () => {
      const user = userEvent.setup();
      const onShowOriginal = jest.fn();

      await renderAtResult(
        { imageUrl: 'data:image/jpeg;base64,result' },
        { config: { callbacks: { onShowOriginal } } }
      );

      await user.click(screen.getByRole('button', { name: 'Before' }));
      expect(onShowOriginal).toHaveBeenLastCalledWith(
        'data:image/jpeg;base64,mockedBase64',
        'rug-001'
      );

      await user.click(screen.getByRole('button', { name: 'After' }));
      expect(onShowOriginal).toHaveBeenLastCalledWith('data:image/jpeg;base64,result', 'rug-001');

      expect(onShowOriginal).toHaveBeenCalledTimes(2);
    });

    test('a repeat click on the already-active side is a no-op (does not re-fire onShowOriginal)', async () => {
      const user = userEvent.setup();
      const onShowOriginal = jest.fn();

      await renderAtResult(
        { imageUrl: 'data:image/jpeg;base64,result' },
        { config: { callbacks: { onShowOriginal } } }
      );

      await user.click(screen.getByRole('button', { name: 'After' }));

      expect(onShowOriginal).not.toHaveBeenCalled();
    });

    test('does not render the toggle when config.buttons.showOriginal is false', async () => {
      await renderAtResult(
        { imageUrl: 'data:image/jpeg;base64,result' },
        { config: { buttons: { showOriginal: false } } }
      );

      expect(screen.queryByRole('button', { name: 'Before' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'After' })).not.toBeInTheDocument();
    });
  });

  // ─── Photo overlay: status badge removed, toggle + thumbs on the image ──
  //
  // ANDRING-5b-bildkontroller.md moved the Before/After toggle and the
  // feedback thumbs onto the image itself and removed the status badge
  // entirely (it duplicated what the toggle's own fill/text/aria-pressed
  // already say), originally sharing one row. That shared-row layout was
  // later replaced (decided directly with the user, after measuring that
  // it could make the thumb group entirely invisible on narrow photos --
  // see the PR conversation) with two independently corner-anchored
  // controls: toggle top-left, thumbs bottom-right. These read the real
  // rendered DOM's inline styles/ancestry directly, the same way the
  // ResizeObserver-wiring and footer-spacing tests above do, so a
  // regression is caught even if it never touches the Puppeteer fixtures
  // in tests/visual/overflow.test.js.
  describe('photo overlay: toggle top-left, thumbs bottom-right, independently corner-anchored', () => {
    const renderAtResult = async (generationResult, props = {}) => {
      generateRoomVisualization.mockResolvedValueOnce(generationResult);
      render(<RoomVisualizationFlow {...defaultProps} {...props} />);
      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), makeFile());
      });
      await waitFor(() => screen.getByText('Review Your New Room'));
    };

    // findOverlayAncestor is shared at module scope (top of this file) --
    // the "feedback buttons" describe block below uses it too, to verify
    // the confirmation pill actually relocated into the overlay.

    test('the status badge no longer renders, though the image alt text still conveys the same information', async () => {
      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,result' });

      expect(screen.queryByText('New Design')).not.toBeInTheDocument();
      expect(screen.queryByText('Original Room')).not.toBeInTheDocument();
      // alt text isn't matched by getByText (it's an attribute, not
      // rendered text) -- confirms the accessible description survives
      // the badge's removal rather than this test being a false negative.
      expect(screen.getByAltText('New Design')).toBeInTheDocument();
    });

    test('the toggle and the feedback thumbs are independently corner-anchored, but share the same overlay ancestor', async () => {
      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,result', generationId: 'gen-1' });

      const beforeButton = screen.getByRole('button', { name: 'Before' });
      const likeButton = screen.getByRole('button', { name: 'Yes, it looks realistic' });

      const toggleOverlay = findOverlayAncestor(beforeButton);
      const thumbsOverlay = findOverlayAncestor(likeButton);

      // Same outer overlay (one absolutely-positioned box matching the
      // image), but NOT the same immediate parent -- each control has its
      // own position:absolute wrapper (top-left for the toggle,
      // bottom-right for the thumbs) nested directly inside that shared
      // overlay, rather than being flex siblings in one shared row.
      expect(toggleOverlay).not.toBeNull();
      expect(toggleOverlay).toBe(thumbsOverlay);
      expect(beforeButton.closest('[role="group"]')).not.toBe(likeButton.closest('[role="group"]'));
    });

    test('the favorite button (still in the footer) is not inside the photo overlay', async () => {
      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,result' });

      const favoriteButton = screen.getByRole('button', { name: 'Save to favourites' });
      expect(findOverlayAncestor(favoriteButton)).toBeNull();
    });

    // Found in review: the overlay is a DOM sibling of imageContainerRef,
    // not a descendant -- the pinch/double-tap handlers are attached
    // directly to imageContainerRef's own element (see
    // attachImageContainerRef), so an event that lands on the overlay's
    // own box (including the empty space between the toggle, top-left,
    // and the thumb group, bottom-right) can never bubble to those
    // handlers, regardless of what's visually beneath it. Without
    // pointerEvents:'none' on the overlay and 'auto' restored on each
    // real control, a pinch or double-tap starting in that empty space
    // (visually just "the photo" to the user) would be silently swallowed
    // instead of reaching the image's own zoom gestures.
    test('the overlay itself ignores pointer events so empty space falls through to the image; the real controls do not', async () => {
      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,result', generationId: 'gen-1' });

      const beforeButton = screen.getByRole('button', { name: 'Before' });
      const likeButton = screen.getByRole('button', { name: 'Yes, it looks realistic' });

      const overlay = findOverlayAncestor(beforeButton);
      expect(overlay.style.pointerEvents).toBe('none');

      const toggleGroup = beforeButton.closest('[role="group"]');
      const thumbGroup = likeButton.closest('[role="group"]');
      expect(toggleGroup.style.pointerEvents).toBe('auto');
      expect(thumbGroup.style.pointerEvents).toBe('auto');
    });

    // Found in review: every other test in this describe block checks
    // WHERE the overlay sits in the DOM or what its static styles are,
    // not the actual arithmetic in measureOverlayAnchor -- and
    // tests/visual/overflow.test.js's Puppeteer suite re-implements that
    // arithmetic independently in hand-authored HTML rather than calling
    // the real component, so a regression in the real getBoundingClientRect
    // subtraction could pass both suites. This mocks getBoundingClientRect
    // on the real imageContainerRef element (jsdom returns all-zero rects
    // by default, which is why nothing else in this file relies on it)
    // and asserts the overlay's own rendered top/left/width/height against
    // values computed by hand from the same formula -- if
    // measureOverlayAnchor's real implementation changes, this fails
    // independently of the Puppeteer fixture.
    test('measureOverlayAnchor positions the real overlay from real element rects (mocked, not a fixture)', async () => {
      class MockResizeObserver {
        constructor(callback) {
          this.callback = callback;
        }
        observe(element) {
          this.element = element;
          MockResizeObserver.instances.push(this);
        }
        unobserve() {}
        disconnect() {}
      }
      MockResizeObserver.instances = [];
      const originalResizeObserver = global.ResizeObserver;
      global.ResizeObserver = MockResizeObserver;

      try {
        await renderAtResult({ imageUrl: 'data:image/jpeg;base64,result', generationId: 'gen-1' });

        const beforeButton = screen.getByRole('button', { name: 'Before' });
        const overlay = findOverlayAncestor(beforeButton);
        const imageContainerObserver = MockResizeObserver.instances.find(
          i => i.element.style.display === 'inline-block'
        );
        const imageContainerEl = imageContainerObserver.element;

        jest.spyOn(imageContainerEl, 'getBoundingClientRect').mockReturnValue({
          top: 100,
          left: 20,
          width: 300,
          height: 150,
          bottom: 250,
          right: 320,
          x: 20,
          y: 100,
          toJSON() {},
        });

        // Re-runs measureOverlayAnchor with the mocked rect now in place
        // -- the observer's callback ignores its own argument and always
        // re-measures (see attachImageContainerRef), so any value works
        // here; what matters is that it fires after the mock above.
        act(() => {
          imageContainerObserver.callback([{ contentRect: { height: 150 } }]);
        });

        // overlayEl.offsetParent is always null in jsdom (no real layout
        // engine), so measureOverlayAnchor's fallback -- document.body --
        // is the real containing element here, and jsdom's own default
        // getBoundingClientRect for it is {top:0, left:0, ...}, left
        // unmocked deliberately: this is the same fallback production
        // takes whenever the overlay's real offsetParent isn't
        // resolvable. The overlay's own box now matches the image's box
        // EXACTLY (no +14/-28 inset baked in here -- each control applies
        // its own inset from its own corner instead), so this is a direct
        // getBoundingClientRect subtraction with no further arithmetic:
        //   top = imageRect.top(100) - containingRect.top(0) = 100
        //   left = imageRect.left(20) - containingRect.left(0) = 20
        expect(overlay.style.top).toBe('100px');
        expect(overlay.style.left).toBe('20px');
        expect(overlay.style.width).toBe('300px');
        expect(overlay.style.height).toBe('150px');
      } finally {
        global.ResizeObserver = originalResizeObserver;
      }
    });

    // Found in review: getBoundingClientRect() is measured from the
    // containing element's BORDER box, but a position:absolute child's
    // top/left resolve against its PADDING box -- .getroomly-modal-
    // container (the real containingEl in production) has a real 1px
    // border (index.css's .border class), which the previous test above
    // can't catch at all, since document.body (its containingEl, the
    // jsdom fallback) has no border and clientTop/clientLeft of 0 either
    // way. This mocks a nonzero clientTop/clientLeft on that same
    // fallback element specifically to exercise the correction itself,
    // independent of which real element ends up being containingEl.
    test('measureOverlayAnchor corrects for a bordered containing element (clientTop/clientLeft), not just its border-box origin', async () => {
      class MockResizeObserver {
        constructor(callback) {
          this.callback = callback;
        }
        observe(element) {
          this.element = element;
          MockResizeObserver.instances.push(this);
        }
        unobserve() {}
        disconnect() {}
      }
      MockResizeObserver.instances = [];
      const originalResizeObserver = global.ResizeObserver;
      global.ResizeObserver = MockResizeObserver;

      const clientTopSpy = jest.spyOn(document.body, 'clientTop', 'get').mockReturnValue(1);
      const clientLeftSpy = jest.spyOn(document.body, 'clientLeft', 'get').mockReturnValue(1);

      try {
        await renderAtResult({ imageUrl: 'data:image/jpeg;base64,result', generationId: 'gen-1' });

        const beforeButton = screen.getByRole('button', { name: 'Before' });
        const overlay = findOverlayAncestor(beforeButton);
        const imageContainerObserver = MockResizeObserver.instances.find(
          i => i.element.style.display === 'inline-block'
        );

        jest.spyOn(imageContainerObserver.element, 'getBoundingClientRect').mockReturnValue({
          top: 100,
          left: 20,
          width: 300,
          height: 150,
          bottom: 250,
          right: 320,
          x: 20,
          y: 100,
          toJSON() {},
        });
        act(() => {
          imageContainerObserver.callback([{ contentRect: { height: 150 } }]);
        });

        // containingRect (document.body's own getBoundingClientRect,
        // unmocked) is still {top:0, left:0, ...} in jsdom -- only
        // clientTop/clientLeft are mocked here, isolating the correction
        // this test targets: top = 100 - 0 - 1 = 99, left = 20 - 0 - 1 = 19.
        expect(overlay.style.top).toBe('99px');
        expect(overlay.style.left).toBe('19px');
      } finally {
        global.ResizeObserver = originalResizeObserver;
        clientTopSpy.mockRestore();
        clientLeftSpy.mockRestore();
      }
    });

    // Found in review (caught by actually screenshotting the narrowest
    // case, not by numeric-only checks): two independently, correctly
    // positioned controls (toggle top-left, thumbs bottom-right) can
    // still visually overlap if the toggle's own wrapped text grows tall
    // enough to reach the thumb group underneath it. Fixed by measuring
    // the bottom-right corner's real rendered height and capping the
    // toggle's own maxHeight to whatever's left above it -- this
    // exercises that real formula directly (bottomControlHeight in
    // RoomVisualizationFlow.tsx), independent of the Puppeteer fixture in
    // tests/visual/overflow.test.js, which re-implements it separately.
    test("the toggle group's maxHeight is capped by the bottom-right corner's real measured height, not a static guess", async () => {
      class MockResizeObserver {
        constructor(callback) {
          this.callback = callback;
        }
        observe(element) {
          this.element = element;
          MockResizeObserver.instances.push(this);
        }
        unobserve() {}
        disconnect() {}
      }
      MockResizeObserver.instances = [];
      const originalResizeObserver = global.ResizeObserver;
      global.ResizeObserver = MockResizeObserver;

      try {
        await renderAtResult({ imageUrl: 'data:image/jpeg;base64,result', generationId: 'gen-1' });

        const beforeButton = screen.getByRole('button', { name: 'Before' });
        const toggleGroup = beforeButton.closest('[role="group"]');
        const imageContainerObserver = MockResizeObserver.instances.find(
          i => i.element.style.display === 'inline-block'
        );
        // bottomControlRef's own wrapper -- position:absolute + bottom:
        // 14px + right:14px together are unique to it in this component
        // (the toggle group uses top+left, not bottom+right).
        const bottomControlObserver = MockResizeObserver.instances.find(
          i => i.element.style.bottom === '14px' && i.element.style.right === '14px'
        );
        expect(bottomControlObserver).toBeDefined();

        jest.spyOn(imageContainerObserver.element, 'getBoundingClientRect').mockReturnValue({
          top: 0,
          left: 0,
          width: 84,
          height: 150,
          bottom: 150,
          right: 84,
          x: 0,
          y: 0,
          toJSON() {},
        });
        act(() => {
          imageContainerObserver.callback([{ contentRect: { height: 150 } }]);
        });

        // The mock ResizeObserver's callback takes contentRect directly
        // (not derived from getBoundingClientRect) -- this is the real
        // measured height a genuinely-wrapped thumb group would report at
        // an extremely narrow width (see the Puppeteer suite's own
        // measured ~96px for that case).
        act(() => {
          bottomControlObserver.callback([{ contentRect: { height: 96 } }]);
        });

        // maxHeight = overlayHeight(150) - 14 - bottomControlHeight(96) - 14 - 8 = 18
        expect(toggleGroup.style.maxHeight).toBe('18px');
        expect(toggleGroup.style.overflow).toBe('hidden');
      } finally {
        global.ResizeObserver = originalResizeObserver;
      }
    });

    // Found in review: without ResizeObserver at all (older browsers), the
    // effect observing bottomControlRef used to leave bottomControlHeight
    // permanently null, which the toggle's maxHeight formula reads as
    // "not yet measured" -- meaning the collision cap never applied for
    // the WHOLE session there. A static fallback constant (96px, the
    // thumb group's own worst-case wrapped height) was tried next and
    // ALSO found wrong in review: it clips the toggle's ordinary
    // single-line case on any normal wide image (which only needs 44px,
    // not 96) and never releases the reservation once feedbackState
    // reaches 'gone' and the wrapper is empty (needing 0px). Fixed
    // properly: getBoundingClientRect() needs no ResizeObserver at all, so
    // it's used as a real, always-correct measurement in every browser --
    // this test mocks a specific height on the real bottom-control wrapper
    // element and confirms the toggle's cap reflects THAT real value, not
    // a guess, even with ResizeObserver entirely absent.
    test('without ResizeObserver at all, the toggle still gets a real measurement, not a static guess', async () => {
      const originalResizeObserver = global.ResizeObserver;
      delete global.ResizeObserver;

      try {
        await renderAtResult({ imageUrl: 'data:image/jpeg;base64,result', generationId: 'gen-1' });

        const beforeButton = screen.getByRole('button', { name: 'Before' });
        const toggleGroup = beforeButton.closest('[role="group"]');
        const imageContainerEl = screen.getByAltText('New Design').parentElement;
        const likeButton = screen.getByRole('button', { name: 'Yes, it looks realistic' });
        // bottomControlRef's own stable wrapper -- the immediate parent of
        // the thumb group's role="group" div (see renderPhotoOverlay).
        const bottomControlEl = likeButton.closest('[role="group"]').parentElement;

        jest.spyOn(imageContainerEl, 'getBoundingClientRect').mockReturnValue({
          top: 0,
          left: 0,
          width: 84,
          height: 150,
          bottom: 150,
          right: 84,
          x: 0,
          y: 0,
          toJSON() {},
        });
        // A distinct, deliberately-chosen value (96, matching what a
        // genuinely-wrapped thumb group measures at 84px width in the
        // Puppeteer suite) -- confirms the toggle's cap comes from THIS
        // specific mocked measurement, not a coincidentally-matching
        // constant baked into the source.
        jest.spyOn(bottomControlEl, 'getBoundingClientRect').mockReturnValue({
          top: 0,
          left: 0,
          width: 56,
          height: 96,
          bottom: 96,
          right: 56,
          x: 0,
          y: 0,
          toJSON() {},
        });
        act(() => {
          window.dispatchEvent(new Event('resize'));
        });
        // Re-runs the bottomControlRef effect (its deps include
        // feedbackState) via a real state transition -- clicking the like
        // button swaps the thumb group for the confirmation pill, exactly
        // the kind of change this effect needs to react to even without
        // ResizeObserver's own continuous observation.
        fireEvent.click(likeButton);

        // maxHeight = overlayHeight(150) - 14 - bottomControlHeight(96) - 14 - 8 = 18
        expect(toggleGroup.style.maxHeight).toBe('18px');
        expect(toggleGroup.style.overflow).toBe('hidden');
      } finally {
        global.ResizeObserver = originalResizeObserver;
      }
    });
  });

  // ─── Double-tap-to-reset-zoom must ignore taps on overlay controls ────────

  describe('double-tap zoom vs. the Before/After toggle', () => {
    const renderAtResult = async generationResult => {
      generateRoomVisualization.mockResolvedValueOnce(generationResult);
      render(<RoomVisualizationFlow {...defaultProps} />);
      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), makeFile());
      });
      await waitFor(() => screen.getByText('Review Your New Room'));
    };

    // jsdom implements the TouchEvent constructor but not the Touch
    // constructor -- a plain object with target/clientX/clientY/identifier
    // works fine as a touch list entry (verified: e.touches[0].target
    // correctly resolves to the real element).
    const touch = (target, x = 0, y = 0) => ({ target, clientX: x, clientY: y, identifier: 0 });
    const dispatchTouchStart = (el, touches) => {
      el.dispatchEvent(new TouchEvent('touchstart', { touches, bubbles: true }));
    };

    test('a rapid double-tap directly on the image still resets zoom (the feature itself still works)', async () => {
      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,result' });
      const img = screen.getByAltText('New Design');
      const container = img.parentElement;

      // Pinch-zoom in first, via a real two-finger touchstart + touchmove,
      // so there's something for the double-tap to reset.
      await act(async () => {
        container.dispatchEvent(
          new TouchEvent('touchstart', {
            touches: [touch(img, 0, 0), touch(img, 100, 0)],
            bubbles: true,
          })
        );
        container.dispatchEvent(
          new TouchEvent('touchmove', {
            touches: [touch(img, 0, 0), touch(img, 200, 0)],
            bubbles: true,
            cancelable: true,
          })
        );
      });
      expect(img.style.transform).toBe('scale(2)');

      await act(async () => {
        dispatchTouchStart(container, [touch(img)]);
        dispatchTouchStart(container, [touch(img)]);
      });

      expect(img.style.transform).toBe('scale(1)');
    });

    test('rapidly switching Before -> After via the toggle does not reset an already-zoomed image', async () => {
      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,result' });
      const img = screen.getByAltText('New Design');
      const container = img.parentElement;
      const beforeButton = screen.getByRole('button', { name: 'Before' });
      const afterButton = screen.getByRole('button', { name: 'After' });

      await act(async () => {
        container.dispatchEvent(
          new TouchEvent('touchstart', {
            touches: [touch(img, 0, 0), touch(img, 100, 0)],
            bubbles: true,
          })
        );
        container.dispatchEvent(
          new TouchEvent('touchmove', {
            touches: [touch(img, 0, 0), touch(img, 200, 0)],
            bubbles: true,
            cancelable: true,
          })
        );
      });
      expect(img.style.transform).toBe('scale(2)');

      // Two taps on two DIFFERENT buttons, both within the 300ms
      // double-tap window -- would have reset zoom before this fix, since
      // both are touchstart events with touches.length === 1 inside the
      // same imageContainerRef.
      await act(async () => {
        dispatchTouchStart(container, [touch(beforeButton)]);
        dispatchTouchStart(container, [touch(afterButton)]);
      });

      expect(img.style.transform).toBe('scale(2)');
    });
  });

  // ─── Favorite button ───────────────────────────────────────────────────────

  describe('favorite button', () => {
    const renderAtResult = async (generationResult, props = {}) => {
      generateRoomVisualization.mockResolvedValueOnce(generationResult);
      render(<RoomVisualizationFlow {...defaultProps} {...props} />);
      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), makeFile());
      });
      await waitFor(() => screen.getByText('Review Your New Room'));
    };

    test('starts unfavorited, labeled "Save to favourites", aria-pressed false', async () => {
      await renderAtResult({ imageUrl: 'blob:result' });

      const button = screen.getByRole('button', { name: 'Save to favourites' });
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute('aria-pressed', 'false');
    });

    test('starts favorited when config.isFavorite is true, labeled "Saved to favourites", aria-pressed true', async () => {
      await renderAtResult({ imageUrl: 'blob:result' }, { config: { isFavorite: true } });

      const button = screen.getByRole('button', { name: 'Saved to favourites' });
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute('aria-pressed', 'true');
    });

    test('clicking toggles the label, aria-pressed, and calls onFavorite with the result image', async () => {
      const onFavorite = jest.fn();
      await renderAtResult({ imageUrl: 'blob:result' }, { config: { callbacks: { onFavorite } } });

      fireEvent.click(screen.getByRole('button', { name: 'Save to favourites' }));

      const button = screen.getByRole('button', { name: 'Saved to favourites' });
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute('aria-pressed', 'true');
      expect(onFavorite).toHaveBeenCalledWith('blob:result', 'rug-001');
    });

    test('is not rendered when config.buttons.favorite is false', async () => {
      await renderAtResult(
        { imageUrl: 'blob:result' },
        { config: { buttons: { favorite: false } } }
      );

      expect(screen.queryByRole('button', { name: 'Save to favourites' })).not.toBeInTheDocument();
    });
  });

  // ─── Result image maxHeight (ResizeObserver wiring) ────────────────────────
  //
  // jsdom has no real layout engine, so these can't verify pixel geometry --
  // that's tests/visual/overflow.test.js's job, via faithful CSS
  // reproductions in a real browser. What that Puppeteer suite can't cover
  // is whether resultContentRef's actual useEffect in
  // RoomVisualizationFlow.tsx really wires up a ResizeObserver on the real
  // content wrapper and really feeds its measurement into the real image's
  // maxHeight -- a regression there (wrong ref, effect not re-running,
  // reading the wrong entry property) would be invisible to a suite that
  // only re-implements the same idea in a hand-authored fixture. This
  // exercises the actual hook, using a controllable ResizeObserver mock so
  // its callback can be fired manually (jsdom doesn't implement a real one,
  // which is also why RoomVisualizationFlow.tsx's own `typeof
  // ResizeObserver === 'undefined'` guard silently no-ops in every other
  // test in this file).
  describe('result image maxHeight (ResizeObserver wiring)', () => {
    class MockResizeObserver {
      constructor(callback) {
        this.callback = callback;
        MockResizeObserver.instances.push(this);
      }
      observe(element) {
        this.element = element;
      }
      unobserve() {}
      disconnect() {}
    }
    MockResizeObserver.instances = [];

    let originalResizeObserver;
    beforeEach(() => {
      originalResizeObserver = global.ResizeObserver;
      MockResizeObserver.instances = [];
      global.ResizeObserver = MockResizeObserver;
    });
    afterEach(() => {
      global.ResizeObserver = originalResizeObserver;
    });

    const renderAtResult = async generationResult => {
      generateRoomVisualization.mockResolvedValueOnce(generationResult);
      render(<RoomVisualizationFlow {...defaultProps} />);
      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), makeFile());
      });
      await waitFor(() => screen.getByText('Review Your New Room'));
    };

    test('starts at the 150px fallback before any ResizeObserver measurement arrives', async () => {
      await renderAtResult({ imageUrl: 'blob:result' });

      const img = screen.getByAltText('New Design');
      expect(img.style.maxHeight).toBe('150px');
    });

    test("observes the image's content-wrapper ancestor and applies its measured height as maxHeight", async () => {
      await renderAtResult({ imageUrl: 'blob:result' });

      const img = screen.getByAltText('New Design');
      // Two observers exist now: this one (resultContentRef, identified by
      // its own real inline style below) and a second one on
      // imageContainerRef driving the photo overlay's position -- see the
      // next test. Both elements contain the img (imageContainerRef is nested
      // inside resultContentRef), so .contains() alone can't disambiguate
      // them; resultContentRef's flex:'1 1 auto' is unique to it.
      const observer = MockResizeObserver.instances.find(i => i.element.style.flex === '1 1 auto');
      expect(observer).toBeDefined();
      expect(observer.element.contains(img)).toBe(true);

      act(() => {
        observer.callback([{ contentRect: { height: 234 } }]);
      });

      expect(img.style.maxHeight).toBe('234px');
    });

    test('a second ResizeObserver observes imageContainerRef itself, separate from resultContentRef', async () => {
      await renderAtResult({ imageUrl: 'blob:result', generationId: 'gen-1' });

      // imageContainerRef's own inline style (distinct from
      // resultContentRef's flex:'1 1 auto' above) -- display:inline-block
      // is unique to it in this component. Its existence, observing the
      // right element, is what this test actually connects to the real
      // component: jsdom has no real layout engine, so offsetTop/Left/
      // Width/Height all read 0 regardless of what this callback receives
      // -- the resulting position math is only meaningfully verified in
      // the real-browser suite (tests/visual/overflow.test.js).
      const imageContainerObserver = MockResizeObserver.instances.find(
        i => i.element.style.display === 'inline-block'
      );
      const wrapperObserver = MockResizeObserver.instances.find(
        i => i.element.style.flex === '1 1 auto'
      );
      expect(imageContainerObserver).toBeDefined();
      expect(imageContainerObserver).not.toBe(wrapperObserver);
      expect(imageContainerObserver.element).not.toBe(wrapperObserver.element);
      expect(wrapperObserver.element.contains(imageContainerObserver.element)).toBe(true);
    });
  });

  // ─── Result footer spacing (real component styles) ─────────────────────────
  //
  // tests/visual/overflow.test.js's Puppeteer suite verifies the CONSEQUENCE
  // of this spacing in real layout (footer/image geometry), but does so
  // against a hand-authored HTML fixture that hard-codes the same gap/
  // minHeight values it's meant to protect -- reverting the actual
  // production styles wouldn't be caught by that fixture at all, since it
  // never reads from RoomVisualizationFlow.tsx. This reads the real
  // rendered DOM's inline style attributes straight off the actual
  // component, so a revert of either value fails here regardless of what
  // the Puppeteer fixture assumes.
  describe('result footer spacing (real component styles)', () => {
    const renderAtResult = async generationResult => {
      generateRoomVisualization.mockResolvedValueOnce(generationResult);
      const utils = render(<RoomVisualizationFlow {...defaultProps} />);
      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), makeFile());
      });
      await waitFor(() => screen.getByText('Review Your New Room'));
      return utils;
    };

    test('the footer column uses an 8px row gap, and the disclaimer pulls the tertiary row 4px closer', async () => {
      await renderAtResult({ imageUrl: 'blob:result' });

      // The permanent disclaimer text is a stable anchor -- unlike the old
      // download-status line (now gone, replaced by the download button's
      // own label swapping -- see the "download to device" describe block
      // below), this element always renders regardless of any transient
      // confirmation state.
      const disclaimer = screen.getByText(
        'The image is an estimate. Measure at home before you buy.'
      );
      expect(disclaimer.style.margin).toBe('0px 0px -4px');

      // The disclaimer is a direct child of the footer's own flex column,
      // per renderResultFooter's structure -- its parent IS the element
      // whose gap this asserts.
      const footerColumn = disclaimer.parentElement;
      expect(footerColumn.style.gap).toBe('8px');
    });
  });

  // ─── Like/Dislike feedback ─────────────────────────────────────────────────

  describe('feedback buttons', () => {
    const renderAtResult = async generationResult => {
      generateRoomVisualization.mockResolvedValueOnce(generationResult);
      render(<RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />);
      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), makeFile());
      });
      await waitFor(() => screen.getByText('Review Your New Room'));
    };

    test('Like button submits "up" feedback for the generationId with the partner API key', async () => {
      await renderAtResult({ imageUrl: 'blob:result', generationId: 'gen-1' });

      fireEvent.click(screen.getByRole('button', { name: 'Yes, it looks realistic' }));

      expect(submitFeedback).toHaveBeenCalledWith('gen-1', 'up', 'partner-abc');
    });

    test('Dislike button submits "down" feedback for the generationId', async () => {
      await renderAtResult({ imageUrl: 'blob:result', generationId: 'gen-1' });

      fireEvent.click(screen.getByRole('button', { name: "No, it doesn't look realistic" }));

      expect(submitFeedback).toHaveBeenCalledWith('gen-1', 'down', 'partner-abc');
    });

    test('does not call submitFeedback when the result has no generationId', async () => {
      await renderAtResult({ imageUrl: 'blob:result' });

      fireEvent.click(screen.getByRole('button', { name: 'Yes, it looks realistic' }));

      expect(submitFeedback).not.toHaveBeenCalled();
    });

    test('after one click, both feedback circle buttons unmount and a confirmation pill appears on the image', async () => {
      await renderAtResult({ imageUrl: 'blob:result', generationId: 'gen-1' });

      fireEvent.click(screen.getByRole('button', { name: 'Yes, it looks realistic' }));

      // Both buttons unmount once feedbackState leaves 'open' — a second click
      // is impossible in real usage because there's no button left to click,
      // not because a handler guards against it. Confirmed by their absence.
      expect(
        screen.queryByRole('button', { name: 'Yes, it looks realistic' })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: "No, it doesn't look realistic" })
      ).not.toBeInTheDocument();
      expect(submitFeedback).toHaveBeenCalledTimes(1);

      // Two elements now carry this text: the visible confirmation pill on
      // the image, and a visually-hidden aria-live region carrying the same
      // string so screen readers get an announcement too (a region that
      // only appears once its text is already set isn't reliably announced
      // — this one instead stays mounted the whole time and only its text
      // content changes, see the comment in RoomVisualizationFlow.tsx).
      const matches = screen.getAllByText('Thanks for your feedback.');
      expect(matches).toHaveLength(2);

      // Not just that two matches exist somewhere -- the visible one (the
      // <div>, not the hidden <span role="status">) must actually be
      // inside the photo overlay. A regression that left the pill
      // rendering in the footer (with the hidden live region supplying
      // the other match) would still pass the length check above.
      const visiblePill = matches.find(el => el.tagName === 'DIV');
      expect(visiblePill).toBeDefined();
      expect(findOverlayAncestor(visiblePill)).not.toBeNull();
    });

    test('the confirmation pill and its live-region announcement both clear after 2200ms', async () => {
      jest.useFakeTimers();
      try {
        await renderAtResult({ imageUrl: 'blob:result', generationId: 'gen-1' });

        fireEvent.click(screen.getByRole('button', { name: 'Yes, it looks realistic' }));
        expect(screen.getAllByText('Thanks for your feedback.')).toHaveLength(2);

        act(() => {
          jest.advanceTimersByTime(2200);
        });

        // Spec: "Inget visas på platsen därefter" -- nothing shown there
        // afterwards, not an empty placeholder (there's no footer row left
        // to preserve height for; this now lives on the image, where a
        // vanished element doesn't shift anything else).
        expect(screen.queryByText('Thanks for your feedback.')).not.toBeInTheDocument();
      } finally {
        jest.useRealTimers();
      }
    });

    test('the confirmation pill can wrap its own text at narrow widths (real inline styles, not a fixture)', async () => {
      await renderAtResult({ imageUrl: 'blob:result', generationId: 'gen-1' });

      fireEvent.click(screen.getByRole('button', { name: 'Yes, it looks realistic' }));

      // maxWidth alone only caps the pill's own box -- it doesn't let the
      // TEXT inside wrap, so an unbreakable word can still overflow the
      // box and get clipped by the overlay's own overflow:hidden one level
      // up (found in review, verified with Puppeteer in
      // tests/visual/overflow.test.js, which can't itself read these
      // real inline styles off the actual component the way this can).
      // Two elements carry this text (the visible pill and the hidden
      // live-region span, see the earlier test) -- the pill is the <div>,
      // the live region is a <span role="status">.
      const pill = screen
        .getAllByText('Thanks for your feedback.')
        .find(el => el.tagName === 'DIV');
      expect(pill).toBeDefined();
      // jsdom's CSSOM normalizes the numeric 0 without a unit suffix
      // (real browsers report '0px') -- '0' either way confirms the
      // style is actually set, which is what this test is checking.
      expect(pill.style.minWidth).toBe('0');
      expect(pill.style.overflowWrap).toBe('break-word');
    });

    test('a rejected submitFeedback call does not throw or crash the component', async () => {
      submitFeedback.mockRejectedValueOnce(new Error('network error'));
      await renderAtResult({ imageUrl: 'blob:result', generationId: 'gen-1' });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Yes, it looks realistic' }));
      });

      // Still renders the result step — a failed feedback PATCH must never break the UI.
      expect(screen.getByText('Review Your New Room')).toBeInTheDocument();
    });
  });

  // ─── Add to Basket confirmation ─────────────────────────────────────────────

  describe('add to basket confirmation', () => {
    const renderAtResult = async (generationResult, props = {}) => {
      generateRoomVisualization.mockResolvedValueOnce(generationResult);
      render(<RoomVisualizationFlow {...defaultProps} {...props} />);
      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), makeFile());
      });
      await waitFor(() => screen.getByText('Review Your New Room'));
    };

    test('the button\'s own label swaps to "Added ✓" for 2400ms after a click, then reverts', async () => {
      jest.useFakeTimers();
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

      try {
        await renderAtResult({ imageUrl: 'blob:result' });
        expect(screen.queryByText('Added ✓')).not.toBeInTheDocument();

        const addButton = screen.getByText('Add to Basket');
        await user.click(addButton);
        // Same button, new text -- not a separate status line.
        expect(addButton).toHaveTextContent('Added ✓');
        expect(screen.queryByText('Add to Basket')).not.toBeInTheDocument();

        act(() => {
          jest.advanceTimersByTime(2400);
        });
        expect(addButton).toHaveTextContent('Add to Basket');
        expect(screen.queryByText('Added ✓')).not.toBeInTheDocument();
      } finally {
        jest.useRealTimers();
      }
    });

    // Found in review (the same reasoning already applied to the feedback
    // thumbs' own confirmation pill): a label change on a button that
    // already has focus isn't reliably announced by all screen readers on
    // its own, so a visually-hidden, always-mounted live region carries
    // the full-sentence confirmation alongside the visible label swap.
    test('a hidden aria-live region announces the full confirmation sentence alongside the label swap', async () => {
      const user = userEvent.setup();
      await renderAtResult({ imageUrl: 'blob:result' });

      // Two elements share role="status" (the feedback thumbs' own live
      // region is the other one, on the image overlay) -- disambiguated
      // via DOM position: this one is renderResultFooter's own, the
      // disclaimer's immediately preceding sibling per that function's
      // JSX order (action row -> this live region -> disclaimer).
      const disclaimer = screen.getByText(
        'The image is an estimate. Measure at home before you buy.'
      );
      const liveRegion = disclaimer.previousElementSibling;
      expect(liveRegion.getAttribute('role')).toBe('status');
      expect(liveRegion.getAttribute('aria-live')).toBe('polite');
      expect(liveRegion).toHaveTextContent('');

      await user.click(screen.getByText('Add to Basket'));

      expect(liveRegion).toHaveTextContent('The product has been added to your basket.');
    });

    test('still fires onAddToBasket and the getroomly-add-to-cart window event', async () => {
      const user = userEvent.setup();
      const onAddToBasket = jest.fn();
      const eventListener = jest.fn();
      window.addEventListener('getroomly-add-to-cart', eventListener);

      try {
        await renderAtResult(
          { imageUrl: 'blob:result' },
          { config: { callbacks: { onAddToBasket } } }
        );

        await user.click(screen.getByText('Add to Basket'));

        expect(onAddToBasket).toHaveBeenCalledWith('blob:result', 'rug-001');
        expect(eventListener).toHaveBeenCalledTimes(1);
      } finally {
        window.removeEventListener('getroomly-add-to-cart', eventListener);
      }
    });
  });

  describe('tertiary row: New Photo width when saveShare is disabled', () => {
    const renderAtResult = async (generationResult, props = {}) => {
      generateRoomVisualization.mockResolvedValueOnce(generationResult);
      render(<RoomVisualizationFlow {...defaultProps} {...props} />);
      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), makeFile());
      });
      await waitFor(() => screen.getByText('Review Your New Room'));
    };

    test('does not get flex-grow when it is the only tertiary button (saveShare disabled)', async () => {
      await renderAtResult(
        { imageUrl: 'data:image/jpeg;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=' },
        { config: { buttons: { saveShare: false } } }
      );

      const newPhotoButton = screen.getByText('New Photo');
      // flex-grow:0 (not the equal-share row's flex-grow:1) is what stops a
      // lone flex item from stretching to fill the row -- found in review:
      // flex:1 1 0 on every tertiary button meant a solo New Photo button
      // (download/share hidden) stretched to the footer's full width
      // instead of staying a small centred pill.
      expect(newPhotoButton.style.flexGrow).toBe('0');
      expect(screen.queryByText('Download Image')).not.toBeInTheDocument();
      expect(screen.queryByText('Share')).not.toBeInTheDocument();
    });

    test('gets equal-share flex-grow when it shares the row with download/share', async () => {
      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=' });

      const newPhotoButton = screen.getByText('New Photo');
      expect(newPhotoButton.style.flexGrow).toBe('1');
    });
  });

  describe('tertiary row: Download hidden when the Web Share API is available', () => {
    const renderAtResult = async (generationResult, props = {}) => {
      generateRoomVisualization.mockResolvedValueOnce(generationResult);
      render(<RoomVisualizationFlow {...defaultProps} {...props} />);
      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), makeFile());
      });
      await waitFor(() => screen.getByText('Review Your New Room'));
    };

    afterEach(() => {
      delete navigator.share;
      delete navigator.canShare;
    });

    test('shows all three tertiary buttons when navigator.share is unavailable (typical desktop)', async () => {
      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=' });

      expect(screen.getByText('Download Image')).toBeInTheDocument();
      expect(screen.getByText('Share')).toBeInTheDocument();
      expect(screen.getByText('New Photo')).toBeInTheDocument();
    });

    test('shows Download too when navigator.share exists but navigator.canShare does not -- URL/text-only share support, not file support', async () => {
      // Found in review: some browsers expose navigator.share for
      // URL/text sharing without any file-sharing support at all.
      // navigator.canShare (the Level 2 addition) is what actually gates
      // whether a File can be shared -- its absence must NOT be treated
      // the same as file-sharing being available.
      navigator.share = jest.fn().mockResolvedValue(undefined);

      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=' });

      expect(screen.getByText('Download Image')).toBeInTheDocument();
    });

    test('shows Download too when navigator.canShare exists but rejects this image (e.g. an unsupported MIME type)', async () => {
      navigator.share = jest.fn().mockResolvedValue(undefined);
      navigator.canShare = jest.fn().mockReturnValue(false);

      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=' });

      expect(screen.getByText('Download Image')).toBeInTheDocument();
      // The probe was actually asked about this image's own type, not
      // called blindly.
      expect(navigator.canShare).toHaveBeenCalledWith(
        expect.objectContaining({
          files: [expect.objectContaining({ type: 'image/jpeg' })],
        })
      );
    });

    test('shows Download too when navigator.canShare exists but navigator.share is not callable (partial API)', async () => {
      // Found in review: canShare present without a callable share() is a
      // real, if unusual, partial-API case. Without an explicit check,
      // Download could be hidden for a Share button that can never
      // actually open the native sheet -- the user would be left with
      // only the clipboard/download fallback tiers and no direct
      // one-click download.
      navigator.canShare = jest.fn().mockReturnValue(true);

      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=' });

      expect(screen.getByText('Download Image')).toBeInTheDocument();
    });

    test('hides Download and shows only Share + New Photo when the browser can actually share this image as a file', async () => {
      navigator.share = jest.fn().mockResolvedValue(undefined);
      navigator.canShare = jest.fn().mockReturnValue(true);

      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=' });

      expect(screen.queryByText('Download Image')).not.toBeInTheDocument();
      const shareButton = screen.getByText('Share');
      const newPhotoButton = screen.getByText('New Photo');
      expect(shareButton).toBeInTheDocument();
      expect(newPhotoButton).toBeInTheDocument();
      // Two-button case, not the solo one-button case -- both still get
      // the row's equal-share flex-grow, not soloTertiaryButtonStyle's
      // flex-grow:0 (that's specifically for when showSaveShare is false
      // and New Photo is the ONLY button; here showSaveShare is still
      // true, only Download's own visibility is capability-gated).
      expect(shareButton.style.flexGrow).toBe('1');
      expect(newPhotoButton.style.flexGrow).toBe('1');
    });

    test('uses MIME-only probing for canShare (no full base64 decode needed to hide Download)', async () => {
      navigator.share = jest.fn().mockResolvedValue(undefined);
      navigator.canShare = jest.fn().mockReturnValue(true);

      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,###invalid-base64###' });

      expect(screen.queryByText('Download Image')).not.toBeInTheDocument();
      expect(screen.getByText('Share')).toBeInTheDocument();
    });

    test('a hidden Download button does not stop Share from working', async () => {
      const user = userEvent.setup();
      navigator.share = jest.fn().mockResolvedValue(undefined);
      navigator.canShare = jest.fn().mockReturnValue(true);

      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=' });
      await user.click(screen.getByText('Share'));

      expect(navigator.share).toHaveBeenCalledTimes(1);
    });

    test('Share sends the image currently selected via the Before/After toggle, not always the result image', async () => {
      const user = userEvent.setup();
      navigator.share = jest.fn().mockResolvedValue(undefined);
      navigator.canShare = jest.fn().mockReturnValue(true);

      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=' });
      // Switch to "Before" -- Download is hidden, so Share is the only
      // way to save/share the currently-displayed image.
      await user.click(screen.getByRole('button', { name: 'Before' }));
      await user.click(screen.getByText('Share'));

      const shareArg = navigator.share.mock.calls[0][0];
      // makeFile()'s upload content, decoded via the same
      // uploadedImage/resultImage data: URL path -- what matters here is
      // that it's NOT the generated result image, matching what the
      // toggle is currently showing.
      expect(shareArg.files[0].size).not.toBe('fake-result-image'.length);
    });
  });

  describe('download to device (Safari data: URI download fix)', () => {
    // generateRoomVisualization always resolves imageUrl as a base64 data:
    // URI (see ai-generation.ts) — real production traffic never hands
    // handleDownloadToDevice a plain http(s) CDN URL, so fixtures use the
    // same shape to actually exercise the synchronous decode path this fix
    // targets. A plain https: fixture is used separately below to exercise
    // the (currently production-unreachable) non-data: URL branch, which
    // downloads directly with no blob conversion at all.
    const RESULT_DATA_URL = 'data:image/jpeg;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=';

    const renderAtResult = async (generationResult, props = {}) => {
      generateRoomVisualization.mockResolvedValueOnce(generationResult);
      render(<RoomVisualizationFlow {...defaultProps} {...props} />);
      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), makeFile());
      });
      await waitFor(() => screen.getByText('Review Your New Room'));
    };

    // jsdom doesn't implement real navigation, so clicking the <a download>
    // element logs an unimplemented "not implemented" navigation error to
    // stderr — expected noise from exercising the real download link, not a
    // sign that anything is broken.
    let originalConsoleError;
    beforeEach(() => {
      originalConsoleError = console.error;
      console.error = jest.fn();
    });
    afterEach(() => {
      console.error = originalConsoleError;
    });

    test('downloads the data: URI as a blob: URL synchronously, without ever calling fetch', async () => {
      const user = userEvent.setup();
      global.URL.createObjectURL.mockReturnValueOnce('blob:mock-download-url');
      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});

      await renderAtResult({ imageUrl: RESULT_DATA_URL });
      await user.click(screen.getByText('Download Image'));

      // No fetch at all for the data: URL path — the whole point of the
      // fix in this round is that decoding happens synchronously so
      // link.click() fires in the same task as the user gesture, instead
      // of after an awaited fetch() resumes in a later task (which can
      // lose iOS Safari's transient user activation for the download).
      expect(global.fetch).not.toHaveBeenCalled();
      expect(global.URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(clickSpy).toHaveBeenCalledTimes(1);
      const clickedLink = clickSpy.mock.instances[0];
      expect(clickedLink.href).toBe('blob:mock-download-url');
      expect(clickedLink.download).toBe('Test Rug-visualization.jpg');

      // Revocation is deliberately deferred a macrotask (not fired
      // synchronously in the same tick as click()) so it doesn't race
      // Safari's async download start — see the comment in
      // handleDownloadToDevice.
      await waitFor(() =>
        expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-download-url')
      );

      clickSpy.mockRestore();
    });

    test('the download button\'s own label swaps to "Downloaded ✓" for 2400ms after a download, then reverts', async () => {
      jest.useFakeTimers();
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});

      try {
        await renderAtResult({ imageUrl: RESULT_DATA_URL });
        expect(screen.queryByText('Downloaded ✓')).not.toBeInTheDocument();

        const downloadButton = screen.getByText('Download Image');
        await user.click(downloadButton);
        // Same button, new text -- not a separate status line.
        expect(downloadButton).toHaveTextContent('Downloaded ✓');
        expect(screen.queryByText('Download Image')).not.toBeInTheDocument();

        act(() => {
          jest.advanceTimersByTime(2400);
        });
        expect(downloadButton).toHaveTextContent('Download Image');
        expect(screen.queryByText('Downloaded ✓')).not.toBeInTheDocument();
      } finally {
        jest.useRealTimers();
        clickSpy.mockRestore();
      }
    });

    test('announces the download via a hidden aria-live region, not just the visible label swap', async () => {
      const user = userEvent.setup();
      jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      await renderAtResult({ imageUrl: RESULT_DATA_URL });
      const downloadButton = screen.getByText('Download Image');
      // Disambiguated from the add-to-basket, share, and feedback-thumbs
      // live regions via DOM position, the same technique used for
      // addedToBasketAnnouncement above -- there are multiple
      // role="status" aria-live="polite" nodes mounted simultaneously. This
      // is the download-specific one (the first of the two after the
      // tertiary row) -- kept separate from the share one below so the two
      // independent confirmations can never suppress each other.
      const disclaimer = screen.getByText(/is an estimate/i);
      const announcement = disclaimer.nextElementSibling.nextElementSibling;
      expect(announcement).toHaveAttribute('role', 'status');
      expect(announcement).toHaveAttribute('aria-live', 'polite');
      expect(announcement).toHaveTextContent('');

      await user.click(downloadButton);

      expect(announcement).toHaveTextContent('The image has been downloaded.');
    });

    test('names the file "...-original.jpg" and downloads the uploaded photo when showing the original image', async () => {
      const user = userEvent.setup();
      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});

      await renderAtResult({ imageUrl: RESULT_DATA_URL });
      await user.click(screen.getByRole('button', { name: 'Before' }));
      await user.click(screen.getByText('Download Image'));

      expect(global.fetch).not.toHaveBeenCalled();
      const clickedLink = clickSpy.mock.instances[0];
      expect(clickedLink.download).toBe('Test Rug-original.jpg');

      clickSpy.mockRestore();
    });

    test('downloads directly (no blob conversion) for a non-data: URL, so no await ever comes between the click and link.click()', async () => {
      const user = userEvent.setup();
      const nonDataUrl = 'https://cdn.example.com/result.jpg';
      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});

      await renderAtResult({ imageUrl: nonDataUrl });
      await user.click(screen.getByText('Download Image'));

      // Deliberately no fetch-based conversion for a non-data: URL (our own
      // images are always data: URIs, never a real one) — an async
      // conversion here would reintroduce the same user-activation loss on
      // iOS Safari that this fix targets, for a case that can't happen.
      expect(global.fetch).not.toHaveBeenCalled();
      expect(global.URL.createObjectURL).not.toHaveBeenCalled();
      const clickedLink = clickSpy.mock.instances[0];
      expect(clickedLink.href).toBe(nonDataUrl);
      expect(clickedLink.download).toBe('Test Rug-visualization.jpg');

      clickSpy.mockRestore();
    });

    test('calls onSaveShare with the image being downloaded', async () => {
      const user = userEvent.setup();
      jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      const onSaveShare = jest.fn();

      await renderAtResult(
        { imageUrl: RESULT_DATA_URL },
        { config: { callbacks: { onSaveShare } } }
      );
      await user.click(screen.getByText('Download Image'));

      expect(onSaveShare).toHaveBeenCalledWith(RESULT_DATA_URL, 'rug-001');
    });
  });

  describe('share with friends', () => {
    const RESULT_DATA_URL = 'data:image/jpeg;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=';

    const renderAtResult = async generationResult => {
      generateRoomVisualization.mockResolvedValueOnce(generationResult);
      render(<RoomVisualizationFlow {...defaultProps} />);
      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), makeFile());
      });
      await waitFor(() => screen.getByText('Review Your New Room'));
    };

    let originalConsoleError;
    beforeEach(() => {
      originalConsoleError = console.error;
      console.error = jest.fn();
    });
    afterEach(() => {
      console.error = originalConsoleError;
      delete navigator.share;
    });

    test('decodes the data: URL synchronously (no fetch) and calls navigator.share with a File, when available', async () => {
      const user = userEvent.setup();
      navigator.share = jest.fn().mockResolvedValue(undefined);

      await renderAtResult({ imageUrl: RESULT_DATA_URL });
      await user.click(screen.getByText('Share'));

      // dataUrlToBlob, not fetch() -- see handleShareWithFriends's own
      // comment for why (shortens the async chain before a possible tier-3
      // fallback, avoiding the same iOS Safari activation-loss risk
      // handleDownloadToDevice's synchronous conversion already avoids).
      expect(global.fetch).not.toHaveBeenCalled();
      expect(navigator.share).toHaveBeenCalledTimes(1);
      const shareArg = navigator.share.mock.calls[0][0];
      expect(shareArg.files).toHaveLength(1);
      expect(shareArg.files[0]).toBeInstanceOf(File);
      // RESULT_DATA_URL's declared MIME type, decoded from the data: URL
      // itself (see tests/unit/data-url.test.js) -- not a hardcoded value,
      // so a mismatched declared/actual type would be caught here.
      expect(shareArg.files[0].type).toBe('image/jpeg');
      // .jpg, not a hardcoded .png -- found in review: the filename's
      // extension must match what's actually inside the file (see
      // extensionForMimeType in src/lib/data-url.ts), since the backend
      // can also return image/webp for a different generation.
      expect(shareArg.files[0].name).toMatch(/\.jpg$/);
      expect(shareArg.title).toContain('Test Rug');
    });

    test('does not fall back to downloading when navigator.share succeeds', async () => {
      const user = userEvent.setup();
      navigator.share = jest.fn().mockResolvedValue(undefined);
      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});

      await renderAtResult({ imageUrl: RESULT_DATA_URL });
      await user.click(screen.getByText('Share'));

      expect(clickSpy).not.toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    test('falls all the way to tier 3 (download) when navigator.share is unavailable and clipboard is too -- shows "Downloaded ✓" on the SHARE button, not the download button', async () => {
      const user = userEvent.setup();
      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});

      // jsdom has neither navigator.share nor navigator.clipboard by
      // default -- this test's whole point is that BOTH being absent
      // falls all the way through to tier 3, so nothing is mocked for
      // either.
      await renderAtResult({ imageUrl: RESULT_DATA_URL });
      const shareButton = screen.getByText('Share');
      await user.click(shareButton);

      // The data: URL path (see "download to device" above) decodes
      // synchronously and never calls fetch — confirms the download
      // fallback actually ran, not just that a click happened somewhere.
      expect(global.fetch).not.toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(clickSpy.mock.instances[0].download).toBe('Test Rug-visualization.jpg');

      // The SHARE button shows the confirmation -- found in review: an
      // earlier version of this called handleDownloadToDevice directly
      // from this fallback, which would have wrongly confirmed on the
      // DOWNLOAD button (the user clicked Share, not Download).
      expect(shareButton).toHaveTextContent('Downloaded ✓');
      expect(screen.queryByText('Download Image')).toHaveTextContent('Download Image');

      clickSpy.mockRestore();
    });

    test('falls to tier 3 (download) when navigator.share rejects with a real error', async () => {
      const user = userEvent.setup();
      navigator.share = jest.fn().mockRejectedValue(new Error('share failed'));
      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});

      await renderAtResult({ imageUrl: RESULT_DATA_URL });
      await user.click(screen.getByText('Share'));

      expect(clickSpy).toHaveBeenCalledTimes(1);
      clickSpy.mockRestore();
    });

    test('does NOT fall back to downloading when the user cancels the native share sheet (AbortError)', async () => {
      const user = userEvent.setup();
      // A plain object, not `new Error()` -- Node's own built-in
      // DOMException happens to be `instanceof Error`, so it can't
      // reproduce the actual gap found in review: a real browser's
      // DOMException (what the Web Share API actually rejects with) isn't
      // guaranteed to satisfy `instanceof Error` across realms, so the old
      // `error instanceof Error && error.name === 'AbortError'` check could
      // silently miss it and fall through to the clipboard/download tiers
      // on a plain cancellation. This reproduces that failure mode
      // directly: anything with the right `.name`, `instanceof Error` or
      // not, must be treated as a cancellation.
      const abortError = { name: 'AbortError', message: 'cancelled' };
      navigator.share = jest.fn().mockRejectedValue(abortError);
      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});

      await renderAtResult({ imageUrl: RESULT_DATA_URL });
      await user.click(screen.getByText('Share'));

      expect(clickSpy).not.toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    test('an InvalidStateError from navigator.share() (a second share already in flight) is also treated as a no-op, not a real failure', async () => {
      const user = userEvent.setup();
      // What the Web Share API actually rejects with when a second
      // share() is called while a first one is still pending (the native
      // share sheet is open) -- a different error name than AbortError, so
      // it needs its own check rather than being caught incidentally.
      const invalidStateError = { name: 'InvalidStateError', message: 'already sharing' };
      navigator.share = jest.fn().mockRejectedValue(invalidStateError);
      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});

      await renderAtResult({ imageUrl: RESULT_DATA_URL });
      await user.click(screen.getByText('Share'));

      expect(clickSpy).not.toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    test('a second click while the first navigator.share() call is still pending does nothing (no fall-through to clipboard/download)', async () => {
      const user = userEvent.setup();
      let resolveShare;
      navigator.share = jest.fn(
        () =>
          new Promise(resolve => {
            resolveShare = resolve;
          })
      );
      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});

      await renderAtResult({ imageUrl: RESULT_DATA_URL });
      const shareButton = screen.getByText('Share');

      // First click opens the (mocked) native share sheet -- its promise
      // stays pending, simulating the sheet still being open.
      await user.click(shareButton);
      expect(navigator.share).toHaveBeenCalledTimes(1);

      // Second click while the sheet is still "open" -- found in review:
      // without a concurrency guard, this started a SECOND, independent
      // handleShareWithFriends() call, whose own navigator.share()
      // rejected with InvalidStateError and silently fell all the way
      // through to a download.
      await user.click(shareButton);
      expect(navigator.share).toHaveBeenCalledTimes(1);
      expect(clickSpy).not.toHaveBeenCalled();

      resolveShare();
      clickSpy.mockRestore();
    });

    // ─── Tier 2: clipboard (new) ───────────────────────────────────────────

    describe('tier 2: clipboard fallback', () => {
      afterEach(() => {
        delete navigator.clipboard;
        delete global.ClipboardItem;
      });

      test('when navigator.share is unavailable but the clipboard API is, writes the image (decoded synchronously, no fetch) and shows "Copied ✓" on the share button', async () => {
        const user = userEvent.setup();
        const clipboardWrite = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
          value: { write: clipboardWrite },
          configurable: true,
        });
        // jsdom has no real ClipboardItem -- a minimal stand-in is enough,
        // since handleShareWithFriends only constructs one and passes it
        // through to the (mocked) write() call, never inspects it itself.
        global.ClipboardItem = class {
          constructor(items) {
            this.items = items;
          }
        };
        const clickSpy = jest
          .spyOn(HTMLAnchorElement.prototype, 'click')
          .mockImplementation(() => {});

        await renderAtResult({ imageUrl: RESULT_DATA_URL });
        const shareButton = screen.getByText('Share');
        await user.click(shareButton);

        // dataUrlToBlob, not fetch() -- see the "decodes the data: URL
        // synchronously" test above for why.
        expect(global.fetch).not.toHaveBeenCalled();
        expect(clipboardWrite).toHaveBeenCalledTimes(1);
        const writtenBlob = clipboardWrite.mock.calls[0][0][0].items['image/jpeg'];
        // RESULT_DATA_URL decodes to 'fake-result-image' (see
        // tests/unit/data-url.test.js) -- checked by type/size rather than
        // object identity or .text(), since jsdom's Blob has neither a
        // real content-equality check nor a .text() method.
        expect(writtenBlob.type).toBe('image/jpeg');
        expect(writtenBlob.size).toBe('fake-result-image'.length);
        // Tier 2 succeeding means tier 3 (download) never runs.
        expect(clickSpy).not.toHaveBeenCalled();

        expect(shareButton).toHaveTextContent('Copied ✓');

        clickSpy.mockRestore();
      });

      test('announces the copy via its own hidden aria-live region, independent of the download one', async () => {
        const user = userEvent.setup();
        Object.defineProperty(navigator, 'clipboard', {
          value: { write: jest.fn().mockResolvedValue(undefined) },
          configurable: true,
        });
        global.ClipboardItem = class {};

        await renderAtResult({ imageUrl: RESULT_DATA_URL });
        const shareButton = screen.getByText('Share');
        const disclaimer = screen.getByText(/is an estimate/i);
        // The download announcement is the first span after the tertiary
        // row, the share announcement is the second -- two separate nodes
        // (found in review: a single shared node with one state taking
        // precedence could silently drop the other confirmation's
        // announcement if both were active at once, e.g. downloading then
        // sharing before the download's own 2400ms window expires).
        const downloadAnnouncement = disclaimer.nextElementSibling.nextElementSibling;
        const shareAnnouncement = downloadAnnouncement.nextElementSibling;
        expect(shareAnnouncement).toHaveAttribute('role', 'status');
        expect(shareAnnouncement).toHaveAttribute('aria-live', 'polite');
        expect(shareAnnouncement).toHaveTextContent('');

        await user.click(shareButton);

        expect(shareAnnouncement).toHaveTextContent('The image has been copied to your clipboard.');
        // The download announcement stays untouched by a share action.
        expect(downloadAnnouncement).toHaveTextContent('');
      });

      test('a download confirmation does not suppress a share confirmation announced right after it', async () => {
        jest.useFakeTimers();
        const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
        jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        Object.defineProperty(navigator, 'clipboard', {
          value: { write: jest.fn().mockResolvedValue(undefined) },
          configurable: true,
        });
        global.ClipboardItem = class {};

        try {
          await renderAtResult({ imageUrl: RESULT_DATA_URL });
          const disclaimer = screen.getByText(/is an estimate/i);
          const downloadAnnouncement = disclaimer.nextElementSibling.nextElementSibling;
          const shareAnnouncement = downloadAnnouncement.nextElementSibling;

          // Download first -- its own 2400ms confirmation window is now
          // active.
          await user.click(screen.getByText('Download Image'));
          await waitFor(() => expect(downloadAnnouncement).toHaveTextContent('downloaded'));

          // Share, via the clipboard tier, while the download confirmation
          // is still showing. With a single shared live region and
          // downloadButtonConfirmed given precedence, this would have kept
          // announcing the download text and silently dropped the copy
          // announcement entirely.
          await user.click(screen.getByText('Share'));
          await waitFor(() =>
            expect(shareAnnouncement).toHaveTextContent(
              'The image has been copied to your clipboard.'
            )
          );
          expect(downloadAnnouncement).toHaveTextContent('The image has been downloaded.');
        } finally {
          jest.useRealTimers();
        }
      });

      test('the "Copied ✓" confirmation reverts to "Share" after 2400ms', async () => {
        jest.useFakeTimers();
        const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
        Object.defineProperty(navigator, 'clipboard', {
          value: { write: jest.fn().mockResolvedValue(undefined) },
          configurable: true,
        });
        global.ClipboardItem = class {};

        try {
          await renderAtResult({ imageUrl: RESULT_DATA_URL });
          const shareButton = screen.getByText('Share');
          await user.click(shareButton);
          // handleShareWithFriends awaits clipboard.write() before setting
          // the confirmation state -- with fake timers active, user.click()'s
          // own settling isn't guaranteed to also flush that, so this waits
          // for the visible effect directly rather than assuming the click
          // alone was enough.
          await waitFor(() => expect(shareButton).toHaveTextContent('Copied ✓'));

          act(() => {
            jest.advanceTimersByTime(2400);
          });
          expect(shareButton).toHaveTextContent('Share');
        } finally {
          jest.useRealTimers();
        }
      });

      test('when the clipboard write itself fails, falls through to tier 3 (download) instead', async () => {
        const user = userEvent.setup();
        Object.defineProperty(navigator, 'clipboard', {
          value: { write: jest.fn().mockRejectedValue(new Error('denied')) },
          configurable: true,
        });
        global.ClipboardItem = class {};
        const clickSpy = jest
          .spyOn(HTMLAnchorElement.prototype, 'click')
          .mockImplementation(() => {});

        await renderAtResult({ imageUrl: RESULT_DATA_URL });
        const shareButton = screen.getByText('Share');
        await user.click(shareButton);

        expect(clickSpy).toHaveBeenCalledTimes(1);
        expect(shareButton).toHaveTextContent('Downloaded ✓');

        clickSpy.mockRestore();
      });
    });
  });
});
