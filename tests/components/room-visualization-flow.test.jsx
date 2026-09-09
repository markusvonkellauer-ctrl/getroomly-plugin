/**
 * RoomVisualizationFlow Component Tests
 *
 * Covers the new coordinate-free upload → processing → result flow.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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
    const accept = input.getAttribute('accept');
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
  // Google Meet screen share), which broke "Show Original" with a broken
  // image and no error. The fix reads the file as a data: URL instead.

  test('"Show Original" displays the uploaded photo as a data: URL, not blob:', async () => {
    generateRoomVisualization.mockResolvedValueOnce({ imageUrl: 'data:image/webp;base64,result' });

    render(<RoomVisualizationFlow {...defaultProps} />);

    await act(async () => {
      uploadFile(document.querySelector('input[type="file"]'), makeFile());
    });

    await waitFor(() => screen.getByText('Review Your New Room'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show Original' }));
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

      fireEvent.click(screen.getByRole('button', { name: 'Like this result' }));

      expect(submitFeedback).toHaveBeenCalledWith('gen-1', 'up', 'partner-abc');
    });

    test('Dislike button submits "down" feedback for the generationId', async () => {
      await renderAtResult({ imageUrl: 'blob:result', generationId: 'gen-1' });

      fireEvent.click(screen.getByRole('button', { name: 'Dislike this result' }));

      expect(submitFeedback).toHaveBeenCalledWith('gen-1', 'down', 'partner-abc');
    });

    test('does not call submitFeedback when the result has no generationId', async () => {
      await renderAtResult({ imageUrl: 'blob:result' });

      fireEvent.click(screen.getByRole('button', { name: 'Like this result' }));

      expect(submitFeedback).not.toHaveBeenCalled();
    });

    test('a second click on the same button is a no-op (feedback already submitted)', async () => {
      await renderAtResult({ imageUrl: 'blob:result', generationId: 'gen-1' });

      const likeButton = screen.getByRole('button', { name: 'Like this result' });
      fireEvent.click(likeButton);
      // Buttons unmount once feedback is submitted (guarded by hasSubmittedFeedback),
      // so a stale reference can't be clicked twice — this asserts that guard.
      expect(screen.queryByRole('button', { name: 'Dislike this result' })).not.toBeInTheDocument();
      expect(submitFeedback).toHaveBeenCalledTimes(1);
    });

    test('a rejected submitFeedback call does not throw or crash the component', async () => {
      submitFeedback.mockRejectedValueOnce(new Error('network error'));
      await renderAtResult({ imageUrl: 'blob:result', generationId: 'gen-1' });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Like this result' }));
      });

      // Still renders the result step — a failed feedback PATCH must never break the UI.
      expect(screen.getByText('Review Your New Room')).toBeInTheDocument();
    });
  });
});
