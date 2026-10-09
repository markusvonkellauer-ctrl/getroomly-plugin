/**
 * RoomVisualizationFlow Component Tests
 *
 * Covers the new coordinate-free upload → processing → result flow.
 */

import fs from 'fs';
import path from 'path';
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoomVisualizationFlow } from '../../src/components/RoomVisualizationFlow';
import { translations } from '../../src/lib/i18n';
import { FOCUSABLE_SELECTOR } from '../../src/hooks/use-focus-trap';

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

jest.mock('../../src/services/event-tracking', () => ({
  trackWidgetEvent: jest.fn(),
}));

import { trackWidgetEvent } from '../../src/services/event-tracking';
import { toPngBlob } from '../../src/lib/image-convert';

const mockHeicTo = jest.fn();
jest.mock('heic-to/csp', () => ({ heicTo: (...args) => mockHeicTo(...args) }));

// jsdom has no canvas/createImageBitmap, so PNG conversion for "Copy image" is
// stubbed; the real helper is a thin canvas wrapper.
jest.mock('../../src/lib/image-convert', () => ({
  toPngBlob: jest.fn(async () => new Blob(['png-bytes'], { type: 'image/png' })),
}));

// jsdom has no matchMedia; the component reads (pointer: coarse) to tell a
// phone/tablet from a desktop.
const mockPointer = coarse => {
  window.matchMedia = jest.fn().mockImplementation(query => ({
    matches: coarse && query === '(pointer: coarse)',
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
};

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

// jsdom's bundled cssstyle@2.3.0 has no var() support in its typed property
// setters (background-color, border, color, ...): each one parses the
// assigned value with a strict CSS grammar (e.g. parseColor) and silently
// no-ops when that parse fails, so `element.style.backgroundColor` can never
// read back a value like 'var(--getroomly-primary-deep)' in this test
// environment -- not a getter quirk, the value is never stored at all
// (confirmed by reading cssstyle's source: properties with no dedicated
// typed setter, like border-radius/box-shadow, DO store var() correctly,
// since they fall through to a generic unconditional-store path instead).
// This spies on the prototype setter itself to capture the literal value
// React actually assigns, independent of whether jsdom's storage accepts
// it -- real production correctness for these specific properties is
// already confirmed via real-browser Puppeteer screenshots.
// jsdom has no DragEvent constructor at all (a long-standing jsdom gap --
// https://github.com/jsdom/jsdom/issues/2913), so @testing-library/dom's
// fireEvent.dragLeave falls back to a plain `Event`, whose constructor
// silently drops `relatedTarget` (it's part of MouseEventInit, not the
// generic EventInit RTL's fallback uses) -- unlike `dataTransfer`, RTL has
// no special-case patch for `relatedTarget`, so it never reaches the fired
// event at all. Verified directly: `fireEvent.dragLeave(el, {relatedTarget})`
// produces an event whose `e.relatedTarget` reads back `undefined` in this
// environment. This builds the event by hand and defines the property
// directly on it (the same technique RTL itself uses internally for
// dataTransfer), so the component's real `e.relatedTarget` check gets a
// real value to test against.
const fireDragLeave = (element, relatedTarget) => {
  const event = new Event('dragleave', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'relatedTarget', { value: relatedTarget });
  fireEvent(element, event);
};

const captureStyleSetterCalls = propertyName => {
  const descriptor = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, propertyName);
  const calls = [];
  Object.defineProperty(CSSStyleDeclaration.prototype, propertyName, {
    configurable: true,
    get: descriptor.get,
    set(value) {
      calls.push({ style: this, value });
      descriptor.set.call(this, value);
    },
  });
  return {
    valuesFor: element => calls.filter(c => c.style === element.style).map(c => c.value),
    restore: () => Object.defineProperty(CSSStyleDeclaration.prototype, propertyName, descriptor),
  };
};

describe('RoomVisualizationFlow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    validateImageFile.mockReturnValue({ isValid: true, error: null });
    submitFeedback.mockResolvedValue(undefined);
  });

  // ─── sessionId persistence across modal remounts ──────────────────────────
  // App.tsx only renders this component while isModalOpen is true, so a
  // shopper closing and reopening the modal (e.g. to try a different size)
  // fully unmounts/remounts it. The backend's findReferenceAnchor keys off
  // sessionId to find the PREVIOUS generation for the same room photo and
  // ground the new size against it — if sessionId isn't stable across that
  // remount, the anchor never fires and sizing silently falls back to
  // unreliable text-only instructions (see RUG_SCALE_GROUNDING_HISTORY.md in
  // the backend repo). sessionId must therefore be backed by sessionStorage,
  // not a bare per-mount useState random UUID.
  describe('sessionId persistence', () => {
    const STORAGE_KEY = 'getroomly-session-id';

    beforeEach(() => {
      sessionStorage.clear();
    });

    afterEach(() => {
      sessionStorage.clear();
    });

    const getUsedSessionId = async () => {
      const input = document.querySelector('input[type="file"]');
      await act(async () => {
        uploadFile(input, makeFile());
      });
      await waitFor(() => expect(generateRoomVisualization).toHaveBeenCalled());
      const calls = generateRoomVisualization.mock.calls;
      return calls[calls.length - 1][0].sessionId;
    };

    test('sessionId persists across an unmount + remount in the same tab', async () => {
      generateRoomVisualization.mockResolvedValue({ imageUrl: 'blob:result' });

      const { unmount } = render(<RoomVisualizationFlow {...defaultProps} />);
      const firstSessionId = await getUsedSessionId();
      expect(firstSessionId).toBeTruthy();
      unmount();

      render(<RoomVisualizationFlow {...defaultProps} />);
      const secondSessionId = await getUsedSessionId();

      expect(secondSessionId).toBe(firstSessionId);
      expect(sessionStorage.getItem(STORAGE_KEY)).toBe(firstSessionId);
    });

    test('a fresh tab/session with no sessionStorage entry gets a valid new sessionId', async () => {
      generateRoomVisualization.mockResolvedValue({ imageUrl: 'blob:result' });
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();

      render(<RoomVisualizationFlow {...defaultProps} />);
      const sessionId = await getUsedSessionId();

      expect(sessionId).toBeTruthy();
      expect(typeof sessionId).toBe('string');
      expect(sessionStorage.getItem(STORAGE_KEY)).toBe(sessionId);
    });

    test('falls back to a usable sessionId without crashing if sessionStorage throws', async () => {
      generateRoomVisualization.mockResolvedValue({ imageUrl: 'blob:result' });

      const originalGetItem = Storage.prototype.getItem;
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.getItem = () => {
        throw new Error('storage disabled');
      };
      Storage.prototype.setItem = () => {
        throw new Error('storage disabled');
      };

      try {
        expect(() => render(<RoomVisualizationFlow {...defaultProps} />)).not.toThrow();
        const sessionId = await getUsedSessionId();

        expect(sessionId).toBeTruthy();
        expect(typeof sessionId).toBe('string');
      } finally {
        Storage.prototype.getItem = originalGetItem;
        Storage.prototype.setItem = originalSetItem;
      }
    });
  });

  // ─── Initial render ───────────────────────────────────────────────────────

  test('renders the upload step on mount', () => {
    render(<RoomVisualizationFlow {...defaultProps} />);
    expect(
      screen.getByRole('heading', { name: new RegExp(translations.en.uploadV2HeaderTitle) })
    ).toBeInTheDocument();
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

  test('the upload step content wrapper scrolls instead of clipping when content does not fit (D2 redesign)', () => {
    // D2 redesign: short panels can't always fit the full upload view even
    // in compact mode (brief: "If content still overflows, the panel
    // scrolls internally") -- the content wrapper (not the upload step's
    // own root, which has no height restriction of its own) is what needs
    // overflow:'auto' rather than the 'hidden' processing/result rely on
    // for their own fixed aspect-ratio visuals.
    const { container } = render(<RoomVisualizationFlow {...defaultProps} />);
    const uploadStepRoot = container.querySelector('.getroomly-upload-step');
    expect(uploadStepRoot).not.toBeNull();
    expect(uploadStepRoot.parentElement.style.overflow).toBe('auto');
  });

  describe('upload view (D2 redesign)', () => {
    test('the header "AI" badge is part of the accessible heading name, not hidden from screen readers', () => {
      // Found in review (Copilot, PR #139): "AI" here is a real disclosure
      // (this is an AI-generated visualization), not decorative branding --
      // aria-hidden would give screen-reader users strictly less
      // information than sighted users see.
      render(<RoomVisualizationFlow {...defaultProps} />);

      const heading = screen.getByRole('heading', {
        name: new RegExp(translations.en.uploadV2HeaderTitle),
      });
      expect(heading).toHaveAccessibleName(`AI ${translations.en.uploadV2HeaderTitle}`);
    });

    test('still uploads the dropped file (existing drop-to-upload behaviour is unchanged, just with no visible dragover UI)', async () => {
      // Brief: "do not add new visible UI" for drag-and-drop -- dropping
      // anywhere on the view still works, there's just no dedicated
      // dropzone visual/border to feed drag events through anymore.
      generateRoomVisualization.mockReturnValueOnce(new Promise(() => {}));
      const { container } = render(<RoomVisualizationFlow {...defaultProps} />);
      const uploadStepRoot = container.querySelector('.getroomly-upload-step');
      const file = makeFile();

      fireEvent.drop(uploadStepRoot, { dataTransfer: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText('Transforming your space...')).toBeInTheDocument();
      });
    });

    test('the upload button is a real <button>, not a styled div, with a visible cursor:pointer', () => {
      const { container } = render(<RoomVisualizationFlow {...defaultProps} />);
      const button = screen.getByRole('button', { name: 'Upload Photo' });

      expect(button.tagName).toBe('BUTTON');
      expect(container.querySelector('[style*="cursor: pointer"]')).toBe(button);
    });

    // Found in review (Copilot, PR #140): this central theming regression
    // (D2 hardcoded Nordic Nest's own black/square look as a literal
    // #000000/2px instead of the brand tokens every other primary button in
    // this widget uses) had no automated assertion catching it -- only that
    // the button existed.
    test('the upload button reads its border-radius from a brand token, not a hardcoded value', () => {
      render(<RoomVisualizationFlow {...defaultProps} />);
      const button = screen.getByRole('button', { name: 'Upload Photo' });

      expect(button.style.borderRadius).toBe('var(--getroomly-radius-pill)');
    });

    // Verified via source text, not the rendered DOM: jsdom's CSSOM (cssstyle)
    // silently rejects `background-color`/`margin-top`/`height`/`font-size`
    // values that contain var(...) -- the property setter just no-ops,
    // leaving button.style.backgroundColor === '' -- while border-radius
    // happens to be one of the few properties cssstyle's grammar accepts
    // one verbatim through (confirmed by direct probing of jsdom's own
    // CSSStyleDeclaration, not an assumption). A real browser renders this
    // correctly (confirmed via Puppeteer screenshots against the dev
    // server during this PR), so this isn't a real app bug -- just a jsdom
    // limitation that makes the DOM the wrong place to assert this one
    // property. Reading the component's own source is what's left.
    test('the upload button sources its background colour from the same brand token as border-radius', () => {
      const source = fs.readFileSync(
        path.join(__dirname, '../../src/components/RoomVisualizationFlow.tsx'),
        'utf8'
      );
      const buttonBlockStart = source.indexOf('className="getroomly-uv2-button"');
      expect(buttonBlockStart).toBeGreaterThan(-1);
      const buttonBlock = source.slice(buttonBlockStart, buttonBlockStart + 1200);

      expect(buttonBlock).toMatch(/backgroundColor:\s*'var\(--getroomly-primary-deep\)'/);
      expect(buttonBlock).not.toMatch(/#000/i);
    });

    // The thumbnail is decorative (alt="", found in review -- Copilot PR
    // #139: its adjacent visible product name already supplies the same
    // text, so a real alt made screen readers announce it twice), so these
    // locate it via the one <img> this view ever renders at a time, not an
    // accessible name.
    const getProductThumb = () => document.querySelector('.getroomly-upload-v2 img');

    test('renders the product row with thumbnail and name when product data is present', () => {
      render(<RoomVisualizationFlow {...defaultProps} />);

      const thumb = getProductThumb();
      expect(thumb).toHaveAttribute('src', defaultProps.productImages[0]);
      expect(thumb).toHaveAttribute('alt', '');
      expect(screen.getByText(defaultProps.productName)).toBeInTheDocument();
    });

    test('shows just the name, no thumbnail, when there is no product image URL -- never a broken image', () => {
      render(<RoomVisualizationFlow {...defaultProps} productImages={[]} />);

      expect(getProductThumb()).not.toBeInTheDocument();
      expect(screen.getByText(defaultProps.productName)).toBeInTheDocument();
    });

    test('hides the product row entirely when there is no product name either -- never an empty row', () => {
      render(<RoomVisualizationFlow {...defaultProps} productImages={[]} productName="" />);

      expect(screen.queryByText(defaultProps.productName)).not.toBeInTheDocument();
      expect(getProductThumb()).not.toBeInTheDocument();
    });

    test('hides just the thumbnail (keeps the product name) when the image URL fails to load', () => {
      render(<RoomVisualizationFlow {...defaultProps} />);

      fireEvent.error(getProductThumb());

      expect(getProductThumb()).not.toBeInTheDocument();
      expect(screen.getByText(defaultProps.productName)).toBeInTheDocument();
    });

    test("a broken thumbnail for one product does not suppress a later, different product's valid thumbnail after a live swap", () => {
      // Found in review (Copilot, PR #139): this component can stay mounted
      // across a live product swap (the host page changes
      // productImages/productName without remounting -- see the
      // widget_opened/closed identity tests elsewhere in this file). A bare
      // boolean failure flag would keep hiding every LATER product's
      // perfectly valid image forever once any one image had ever failed.
      const { rerender } = render(
        <RoomVisualizationFlow
          {...defaultProps}
          productImages={['https://example.com/broken.jpg']}
        />
      );

      fireEvent.error(getProductThumb());
      expect(getProductThumb()).not.toBeInTheDocument();

      rerender(
        <RoomVisualizationFlow
          {...defaultProps}
          productId="rug-002"
          productName="A Different Rug"
          productImages={['https://example.com/working.jpg']}
        />
      );

      expect(getProductThumb()).toHaveAttribute('src', 'https://example.com/working.jpg');
    });

    // D3 brief section 1b: show the whole product image, never crop --
    // object-fit:cover (D2) cropped non-square rugs into a fragment of the
    // pattern. The white 4px-padded box also covers transparent PNGs.
    test('the thumbnail shows the whole image (object-fit: contain) inside a white padded box', () => {
      render(<RoomVisualizationFlow {...defaultProps} />);

      const thumb = getProductThumb();
      expect(thumb.style.objectFit).toBe('contain');

      const box = thumb.parentElement;
      expect(box.style.background).toBe('rgb(255, 255, 255)');
      expect(box.style.padding).toBe('4px');
      expect(box.style.overflow).toBe('hidden');
    });

    // D3 brief section 1: the headline is gone entirely (not just split by
    // category) -- it repeated the header and cost ~45pt of height.
    test('no longer renders a headline (removed in the D3 update)', () => {
      const { container } = render(<RoomVisualizationFlow {...defaultProps} />);

      expect(container.querySelector('h1')).not.toBeInTheDocument();
      expect(container.querySelector('h3')).not.toBeInTheDocument();
    });

    // Found in review (Copilot, PR #140): `category` is a free-form public
    // config field that genuinely supports sofas/chairs/tables/etc (see
    // embed-config.ts, README.md) -- a single un-split step 2 title said
    // "the rug" for every category. Step 2's title and the trust line's
    // statement are both category-aware now, same mechanism as step 3's
    // body (brief: "Steps 1 and 3 ... stay as they are today" -- step 2 and
    // the trust line don't, by necessity, since their new copy names the
    // product directly).
    test('uses the carpets-specific step 2 title and step 3 body when category is "carpets"', () => {
      render(<RoomVisualizationFlow {...defaultProps} category="carpets" />);

      expect(screen.getByText(translations.en.uploadV2Step2TitleCarpets)).toBeInTheDocument();
      expect(screen.getByText(translations.en.uploadV2Step3BodyCarpets)).toBeInTheDocument();
    });

    test('matches category names containing "carpet" too, not just the exact "carpets" string', () => {
      render(<RoomVisualizationFlow {...defaultProps} category="outdoor-carpet-runners" />);

      expect(screen.getByText(translations.en.uploadV2Step2TitleCarpets)).toBeInTheDocument();
      expect(screen.getByText(translations.en.uploadV2Step3BodyCarpets)).toBeInTheDocument();
    });

    test('falls back to the generic default copy for a non-carpet category', () => {
      render(<RoomVisualizationFlow {...defaultProps} category="sofas" />);

      expect(screen.getByText(translations.en.uploadV2Step2TitleDefault)).toBeInTheDocument();
      expect(screen.getByText(translations.en.uploadV2Step3BodyDefault)).toBeInTheDocument();
    });

    test('shows the de-emphasised size-limit hint as the last line, wired to the button via aria-describedby', () => {
      render(<RoomVisualizationFlow {...defaultProps} />);

      const hint = screen.getByText(translations.en.uploadV2Hint);
      expect(hint.id).toBe('getroomly-uv2-hint');
      expect(hint.style.fontSize).toBe('11px');
      expect(hint.style.fontWeight).toBe('400');
      expect(hint.style.color).toBe('rgb(107, 107, 107)');

      const button = screen.getByRole('button', { name: 'Upload Photo' });
      expect(button).toHaveAttribute('aria-describedby', 'getroomly-uv2-hint');
      const input = document.querySelector('input[type="file"]');
      expect(input).toHaveAttribute('aria-describedby', 'getroomly-uv2-hint');
    });

    // Trust line (simplified, found in review with Markus: the statement
    // sentence and "Läs mer i" prefix were dropped -- just the lock icon
    // and the underlined link remain, one centered line).
    test('the trust line is just the lock icon and the underlined terms link, centered, no statement text', () => {
      render(<RoomVisualizationFlow {...defaultProps} />);

      const link = screen.getByText(translations.en.termsLink);
      expect(link.tagName).toBe('BUTTON');
      expect(link.style.textDecoration).toBe('underline');

      const trustBlock = link.parentElement;
      expect(trustBlock.style.textAlign).toBe('center');
      expect(trustBlock.textContent).toBe(translations.en.termsLink);
    });

    test('step 3 gets a dedicated class so compact-mode CSS can hide only its description, per the handoff brief update', () => {
      // defaultProps.category is 'Carpet', which isCarpetCategory matches
      // -- so this renders the carpets-specific body text.
      const { container } = render(<RoomVisualizationFlow {...defaultProps} />);

      expect(container.querySelector('.getroomly-uv2-step3-desc')).not.toBeNull();
      expect(container.querySelector('.getroomly-uv2-step3-desc').textContent).toBe(
        translations.en.uploadV2Step3BodyCarpets
      );
    });
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
      expect(
        screen.getByRole('heading', { name: new RegExp(translations.en.uploadV2HeaderTitle) })
      ).toBeInTheDocument();
    });
  });

  test('clears the file input on generation failure so the same file can be retried', async () => {
    generateRoomVisualization.mockRejectedValueOnce(new Error('upstream busy'));

    render(<RoomVisualizationFlow {...defaultProps} />);
    const input = document.querySelector('input[type="file"]');

    await act(async () => {
      uploadFile(input, makeFile());
    });

    await waitFor(() =>
      screen.getByRole('heading', { name: new RegExp(translations.en.uploadV2HeaderTitle) })
    );
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

  test('calls onError with the specific weekly-limit message when meta.reason is ipWeeklyCap', async () => {
    // Same error code as the test above (quotaExceeded), but this one is
    // about THIS shopper's own usage specifically (the backend's per-IP
    // anti-abuse cap, distinguished via meta.reason) — so unlike the
    // partner-quota case, it's safe and more helpful to name the actual
    // limit instead of showing the generic message.
    const { AIGenerationError } = jest.requireActual('../../src/services/ai-generation');
    generateRoomVisualization.mockRejectedValueOnce(
      new AIGenerationError(
        "You've reached the weekly limit of 50 visualizations. Please try again next week.",
        'quotaExceeded',
        429,
        { reason: 'ipWeeklyCap' }
      )
    );
    const onError = jest.fn();

    render(<RoomVisualizationFlow {...defaultProps} onError={onError} />);

    await act(async () => {
      uploadFile(document.querySelector('input[type="file"]'), makeFile());
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(translations.en.errorWeeklyLimitReached);
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
    expect(
      screen.getByRole('heading', { name: new RegExp(translations.en.uploadV2HeaderTitle) })
    ).toBeInTheDocument();
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
      expect(
        screen.getByRole('heading', { name: new RegExp(translations.en.uploadV2HeaderTitle) })
      ).toBeInTheDocument();
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
      expect(
        screen.getByRole('heading', { name: new RegExp(translations.en.uploadV2HeaderTitle) })
      ).toBeInTheDocument();
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
      expect(
        screen.getByRole('heading', { name: new RegExp(translations.en.uploadV2HeaderTitle) })
      ).toBeInTheDocument();
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
      expect(
        screen.getByRole('heading', { name: new RegExp(translations.en.uploadV2HeaderTitle) })
      ).toBeInTheDocument();
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

    expect(
      screen.getByRole('heading', { name: new RegExp(translations.en.uploadV2HeaderTitle) })
    ).toBeInTheDocument();
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
      expect(img.style.transform).toBe('translate(0px, 0px) scale(2)');

      await act(async () => {
        dispatchTouchStart(container, [touch(img)]);
        dispatchTouchStart(container, [touch(img)]);
      });

      expect(img.style.transform).toBe('translate(0px, 0px) scale(1)');
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
      expect(img.style.transform).toBe('translate(0px, 0px) scale(2)');

      // Two taps on two DIFFERENT buttons, both within the 300ms
      // double-tap window -- would have reset zoom before this fix, since
      // both are touchstart events with touches.length === 1 inside the
      // same imageContainerRef.
      await act(async () => {
        dispatchTouchStart(container, [touch(beforeButton)]);
        dispatchTouchStart(container, [touch(afterButton)]);
      });

      expect(img.style.transform).toBe('translate(0px, 0px) scale(2)');
    });
  });

  // ─── Single-finger pan while zoomed in ─────────────────────────────────────
  // Found in review: pinch-zoom had no way to look around a zoomed-in photo
  // -- only the center was ever reachable, since the transform was scale()
  // alone with no translate. These verify the pan added alongside it.

  describe('pinch-zoom + single-finger pan', () => {
    const renderAtResult = async generationResult => {
      generateRoomVisualization.mockResolvedValueOnce(generationResult);
      render(<RoomVisualizationFlow {...defaultProps} />);
      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), makeFile());
      });
      await waitFor(() => screen.getByText('Review Your New Room'));
    };

    const touch = (target, x = 0, y = 0) => ({ target, clientX: x, clientY: y, identifier: 0 });

    // clampPan reads the container's own offsetWidth/offsetHeight to bound
    // pan against its actual on-screen size -- jsdom has no real layout
    // engine and reports 0 for both by default, which would clamp every
    // pan in these tests to (0, 0) regardless of the drag distance. Mocked
    // to a realistic box so the clamp math has something real to bound
    // against.
    const mockContainerSize = (container, width = 300, height = 300) => {
      Object.defineProperty(container, 'offsetWidth', { value: width, configurable: true });
      Object.defineProperty(container, 'offsetHeight', { value: height, configurable: true });
    };

    const pinchZoomTo2x = async container => {
      await act(async () => {
        container.dispatchEvent(
          new TouchEvent('touchstart', {
            touches: [touch(container, 0, 0), touch(container, 100, 0)],
            bubbles: true,
          })
        );
        container.dispatchEvent(
          new TouchEvent('touchmove', {
            touches: [touch(container, 0, 0), touch(container, 200, 0)],
            bubbles: true,
            cancelable: true,
          })
        );
      });
    };

    test('a single-finger drag at scale 1 does not pan -- normal page scrolling stays untouched', async () => {
      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,result' });
      const img = screen.getByAltText('New Design');
      const container = img.parentElement;
      mockContainerSize(container);

      await act(async () => {
        container.dispatchEvent(
          new TouchEvent('touchstart', { touches: [touch(container, 100, 100)], bubbles: true })
        );
        container.dispatchEvent(
          new TouchEvent('touchmove', {
            touches: [touch(container, 150, 150)],
            bubbles: true,
            cancelable: true,
          })
        );
      });

      expect(img.style.transform).toBe('translate(0px, 0px) scale(1)');
    });

    test('a single-finger drag pans the image once zoomed in, matching the finger movement', async () => {
      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,result' });
      const img = screen.getByAltText('New Design');
      const container = img.parentElement;
      mockContainerSize(container);

      await pinchZoomTo2x(container);
      expect(img.style.transform).toBe('translate(0px, 0px) scale(2)');

      await act(async () => {
        container.dispatchEvent(
          new TouchEvent('touchstart', { touches: [touch(container, 100, 100)], bubbles: true })
        );
        container.dispatchEvent(
          new TouchEvent('touchmove', {
            touches: [touch(container, 130, 115)],
            bubbles: true,
            cancelable: true,
          })
        );
      });

      // At scale 2 on a 300px container, max pan is (300*(2-1))/2 = 150px
      // either way -- a 30px/15px drag is well inside that, so it should
      // land untouched by clamping.
      expect(img.style.transform).toBe('translate(30px, 15px) scale(2)');
    });

    test('clamps pan so the zoomed image can never be dragged past its own edge', async () => {
      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,result' });
      const img = screen.getByAltText('New Design');
      const container = img.parentElement;
      mockContainerSize(container, 300, 300);

      await pinchZoomTo2x(container);

      await act(async () => {
        container.dispatchEvent(
          new TouchEvent('touchstart', { touches: [touch(container, 0, 0)], bubbles: true })
        );
        // Drag 1000px right/down -- far past what a 300px container at 2x
        // zoom could ever reveal (max is 150px either way).
        container.dispatchEvent(
          new TouchEvent('touchmove', {
            touches: [touch(container, 1000, 1000)],
            bubbles: true,
            cancelable: true,
          })
        );
      });

      expect(img.style.transform).toBe('translate(150px, 150px) scale(2)');
    });

    test('double-tap resets both zoom AND pan back to (0, 0), not just zoom', async () => {
      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,result' });
      const img = screen.getByAltText('New Design');
      const container = img.parentElement;
      mockContainerSize(container);

      await pinchZoomTo2x(container);
      await act(async () => {
        container.dispatchEvent(
          new TouchEvent('touchstart', { touches: [touch(container, 0, 0)], bubbles: true })
        );
        container.dispatchEvent(
          new TouchEvent('touchmove', {
            touches: [touch(container, 50, 50)],
            bubbles: true,
            cancelable: true,
          })
        );
      });
      expect(img.style.transform).toBe('translate(50px, 50px) scale(2)');

      await act(async () => {
        container.dispatchEvent(
          new TouchEvent('touchstart', { touches: [touch(container)], bubbles: true })
        );
        container.dispatchEvent(
          new TouchEvent('touchstart', { touches: [touch(container)], bubbles: true })
        );
      });

      expect(img.style.transform).toBe('translate(0px, 0px) scale(1)');
    });

    test('applies the same pan to the "Before" overlay layer, so panning stays in sync across the toggle', async () => {
      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,result' });
      const afterImg = screen.getByAltText('New Design');
      const beforeImg = screen.getByAltText('Original Room');
      const container = afterImg.parentElement;
      mockContainerSize(container);

      await pinchZoomTo2x(container);
      await act(async () => {
        container.dispatchEvent(
          new TouchEvent('touchstart', { touches: [touch(container, 0, 0)], bubbles: true })
        );
        container.dispatchEvent(
          new TouchEvent('touchmove', {
            touches: [touch(container, 40, 20)],
            bubbles: true,
            cancelable: true,
          })
        );
      });

      expect(afterImg.style.transform).toBe('translate(40px, 20px) scale(2)');
      expect(beforeImg.style.transform).toBe('translate(40px, 20px) scale(2)');
    });

    test('a second pan started shortly after the first is not mistaken for a double-tap and does not reset zoom', async () => {
      // Found in review: onTouchStart stamps lastTapRef on every
      // single-finger touchstart, including ones that turn into a pan, not
      // just genuine taps. Without invalidating that timestamp once real
      // movement happens, a second pan started within the 300ms double-tap
      // window (very plausible when someone swipes twice in a row to
      // explore a zoomed photo) would be misread as the second tap of a
      // double-tap and reset zoom/pan mid-exploration.
      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,result' });
      const img = screen.getByAltText('New Design');
      const container = img.parentElement;
      mockContainerSize(container);

      await pinchZoomTo2x(container);

      await act(async () => {
        container.dispatchEvent(
          new TouchEvent('touchstart', { touches: [touch(container, 0, 0)], bubbles: true })
        );
        container.dispatchEvent(
          new TouchEvent('touchmove', {
            touches: [touch(container, 30, 0)],
            bubbles: true,
            cancelable: true,
          })
        );
        container.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true }));
      });
      expect(img.style.transform).toBe('translate(30px, 0px) scale(2)');

      // Second pan, started immediately after (well within the 300ms
      // double-tap window) -- must keep panning, not reset to scale 1.
      await act(async () => {
        container.dispatchEvent(
          new TouchEvent('touchstart', { touches: [touch(container, 0, 0)], bubbles: true })
        );
        container.dispatchEvent(
          new TouchEvent('touchmove', {
            touches: [touch(container, 20, 0)],
            bubbles: true,
            cancelable: true,
          })
        );
      });

      expect(img.style.transform).toBe('translate(50px, 0px) scale(2)');
    });

    test('re-clamps an existing pan when the container resizes while zoomed in', async () => {
      // Found in review: pan bounds were only applied during a scale/pan
      // update -- if the wrapper resized while zoomed (orientation change,
      // the measured maxHeight changing, etc.), a previously-valid pan
      // could stay outside the new, smaller bounds indefinitely.
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
        await renderAtResult({ imageUrl: 'data:image/jpeg;base64,result' });
        const img = screen.getByAltText('New Design');
        const container = img.parentElement;
        mockContainerSize(container, 300, 300);

        const containerObserver = MockResizeObserver.instances.find(i => i.element === container);

        await pinchZoomTo2x(container);
        // Pan to the max allowed offset at the current (300px) size: (300*1)/2 = 150.
        await act(async () => {
          container.dispatchEvent(
            new TouchEvent('touchstart', { touches: [touch(container, 0, 0)], bubbles: true })
          );
          container.dispatchEvent(
            new TouchEvent('touchmove', {
              touches: [touch(container, 150, 0)],
              bubbles: true,
              cancelable: true,
            })
          );
        });
        expect(img.style.transform).toBe('translate(150px, 0px) scale(2)');

        // Shrink the container (e.g. orientation change) and fire the same
        // ResizeObserver this component already attaches for
        // measureOverlayAnchor -- new max pan at 200px is (200*1)/2 = 100,
        // so the existing 150px pan must be pulled back in.
        mockContainerSize(container, 200, 200);
        act(() => {
          containerObserver.callback([{ contentRect: { height: 200 } }]);
        });

        expect(img.style.transform).toBe('translate(100px, 0px) scale(2)');
      } finally {
        global.ResizeObserver = originalResizeObserver;
      }
    });

    test('clears drag and tap state on touchcancel, so an interrupted gesture cannot misfire the next touch as a double-tap', async () => {
      // Found in review: the browser can interrupt a gesture mid-flight
      // with touchcancel instead of touchend (iOS Safari's edge-swipe-back,
      // Android's system back gesture, a notification taking focus, etc.).
      // Without its own cleanup, an interrupted touchstart would leave
      // lastTapRef stamped, letting the very next touch within 300ms be
      // misread as the second tap of a double-tap and reset zoom/pan.
      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,result' });
      const img = screen.getByAltText('New Design');
      const container = img.parentElement;
      mockContainerSize(container);

      await pinchZoomTo2x(container);

      await act(async () => {
        container.dispatchEvent(
          new TouchEvent('touchstart', { touches: [touch(container, 0, 0)], bubbles: true })
        );
        // Cancelled before any real movement -- e.g. the OS claims the
        // gesture for a system edge-swipe.
        container.dispatchEvent(new TouchEvent('touchcancel', { touches: [], bubbles: true }));
      });

      // A brand-new touch immediately after (well within the 300ms
      // double-tap window) must start a fresh pan, not get reset to scale 1.
      await act(async () => {
        container.dispatchEvent(
          new TouchEvent('touchstart', { touches: [touch(container, 0, 0)], bubbles: true })
        );
        container.dispatchEvent(
          new TouchEvent('touchmove', {
            touches: [touch(container, 25, 0)],
            bubbles: true,
            cancelable: true,
          })
        );
      });

      expect(img.style.transform).toBe('translate(25px, 0px) scale(2)');
    });

    test('an immediate pan right after a pinch is not mistaken for a double-tap, even when the pinch itself began with a stray single-finger touchstart', async () => {
      // Found in review: on real touchscreens, a pinch almost never starts
      // with both fingers landing in the same event -- the first finger
      // typically fires its own single-touch touchstart (stamping
      // lastTapRef) a few ms before the second finger turns it into a
      // two-finger touchstart. Without clearing lastTapRef when the pinch
      // begins, panning immediately after a quick pinch -- the natural next
      // thing to do -- could land within the 300ms double-tap window and
      // get misread as the second tap, resetting the zoom right as the
      // user tries to explore it.
      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,result' });
      const img = screen.getByAltText('New Design');
      const container = img.parentElement;
      mockContainerSize(container);

      await act(async () => {
        // The stray first-finger touchstart that (on real hardware)
        // precedes the second finger landing.
        container.dispatchEvent(
          new TouchEvent('touchstart', { touches: [touch(container, 0, 0)], bubbles: true })
        );
      });

      await pinchZoomTo2x(container);
      expect(img.style.transform).toBe('translate(0px, 0px) scale(2)');

      // Pan immediately after releasing the pinch -- well within the 300ms
      // double-tap window measured from the stray touchstart above.
      await act(async () => {
        container.dispatchEvent(
          new TouchEvent('touchstart', { touches: [touch(container, 0, 0)], bubbles: true })
        );
        container.dispatchEvent(
          new TouchEvent('touchmove', {
            touches: [touch(container, 35, 0)],
            bubbles: true,
            cancelable: true,
          })
        );
      });

      expect(img.style.transform).toBe('translate(35px, 0px) scale(2)');
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

    // The wrapper is flex:1 1 auto, so its height follows the image whose
    // maxHeight is fed from this very measurement. Browsers snap fractional
    // CSS heights down to 1/64px, so storing the raw fractional value made
    // each pass measure slightly less than the last (observed on desktop
    // Chrome at devicePixelRatio 2: ~1/64px per frame, a few px of drift
    // over ~5s). Whole-pixel storage ends that loop after one pass.
    describe('fractional measurements (layout feedback loop)', () => {
      const fireHeight = (observer, height) =>
        act(() => {
          observer.callback([{ contentRect: { height } }]);
        });

      test('rounds a fractional measurement to whole pixels', async () => {
        await renderAtResult({ imageUrl: 'blob:result' });
        const img = screen.getByAltText('New Design');
        const observer = MockResizeObserver.instances.find(
          i => i.element.style.flex === '1 1 auto'
        );

        fireHeight(observer, 346.8);
        expect(img.style.maxHeight).toBe('347px');

        fireHeight(observer, 234.4);
        expect(img.style.maxHeight).toBe('234px');
      });

      test('a run of sub-pixel shrinkage (the 1/64px creep) settles on one stable value instead of tracking it', async () => {
        await renderAtResult({ imageUrl: 'blob:result' });
        const img = screen.getByAltText('New Design');
        const observer = MockResizeObserver.instances.find(
          i => i.element.style.flex === '1 1 auto'
        );

        // Measurements copied from the real desktop-Chrome trace: each
        // frame reported ~1/64px less than the previous maxHeight.
        const creep = [346.719, 346.703, 346.6875, 346.672, 346.656, 346.64, 346.625];
        const seen = new Set();
        for (const h of creep) {
          fireHeight(observer, h);
          seen.add(img.style.maxHeight);
        }

        expect(seen).toEqual(new Set(['347px']));
      });

      test('a real size change (e.g. viewport resize, footer row added) is still applied', async () => {
        await renderAtResult({ imageUrl: 'blob:result' });
        const img = screen.getByAltText('New Design');
        const observer = MockResizeObserver.instances.find(
          i => i.element.style.flex === '1 1 auto'
        );

        fireHeight(observer, 347);
        expect(img.style.maxHeight).toBe('347px');
        fireHeight(observer, 312);
        expect(img.style.maxHeight).toBe('312px');
      });

      test('whole-pixel measurements (the mobile case) are applied unchanged', async () => {
        await renderAtResult({ imageUrl: 'blob:result' });
        const img = screen.getByAltText('New Design');
        const observer = MockResizeObserver.instances.find(
          i => i.element.style.flex === '1 1 auto'
        );

        for (const h of [150, 234, 400, 96]) {
          fireHeight(observer, h);
          expect(img.style.maxHeight).toBe(`${h}px`);
        }
      });
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

    // jsdom has no matchMedia; the component reads (pointer: coarse) to tell
    // a phone/tablet from a desktop that also has the Web Share API.
    const setPointer = coarse => {
      window.matchMedia = jest.fn().mockImplementation(query => ({
        matches: coarse && query === '(pointer: coarse)',
        media: query,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      }));
    };

    beforeEach(() => {
      setPointer(true);
    });

    afterEach(() => {
      delete navigator.share;
      delete navigator.canShare;
      delete window.matchMedia;
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

    test('hides Download and shows only Save/Share + New Photo when the browser can actually share this image as a file', async () => {
      navigator.share = jest.fn().mockResolvedValue(undefined);
      navigator.canShare = jest.fn().mockReturnValue(true);

      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=' });

      expect(screen.queryByText('Download Image')).not.toBeInTheDocument();
      const shareButton = screen.getByText('Save/Share');
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

    test('labels the share button "Save/Share" on a touch device whose share sheet can save the image', async () => {
      navigator.share = jest.fn().mockResolvedValue(undefined);
      navigator.canShare = jest.fn().mockReturnValue(true);

      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=' });

      expect(screen.getByText('Save/Share')).toBeInTheDocument();
      expect(screen.queryByText('Share')).not.toBeInTheDocument();
    });

    test('on a desktop browser that has the Web Share API, shows Download and "Copy Image" (not the share sheet button)', async () => {
      setPointer(false);
      navigator.share = jest.fn().mockResolvedValue(undefined);
      navigator.canShare = jest.fn().mockReturnValue(true);

      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=' });

      expect(screen.getByText('Download Image')).toBeInTheDocument();
      expect(screen.getByText('Copy Image')).toBeInTheDocument();
      expect(screen.queryByText('Share')).not.toBeInTheDocument();
      expect(screen.queryByText('Save/Share')).not.toBeInTheDocument();
    });

    test('keeps plain "Share" when native sharing is unavailable, even on a touch device', async () => {
      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=' });

      expect(screen.getByText('Download Image')).toBeInTheDocument();
      expect(screen.getByText('Share')).toBeInTheDocument();
    });

    test('uses MIME-only probing for canShare (no full base64 decode needed to hide Download)', async () => {
      navigator.share = jest.fn().mockResolvedValue(undefined);
      navigator.canShare = jest.fn().mockReturnValue(true);

      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,###invalid-base64###' });

      expect(screen.queryByText('Download Image')).not.toBeInTheDocument();
      expect(screen.getByText('Save/Share')).toBeInTheDocument();
    });

    test('a hidden Download button does not stop Share from working', async () => {
      const user = userEvent.setup();
      navigator.share = jest.fn().mockResolvedValue(undefined);
      navigator.canShare = jest.fn().mockReturnValue(true);

      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=' });
      await user.click(screen.getByText('Save/Share'));

      expect(navigator.share).toHaveBeenCalledTimes(1);
    });

    test('passes a share title and message in English, with the product name filled in', async () => {
      const user = userEvent.setup();
      navigator.share = jest.fn().mockResolvedValue(undefined);
      navigator.canShare = jest.fn().mockReturnValue(true);

      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=' });
      await user.click(screen.getByText('Save/Share'));

      const shareArg = navigator.share.mock.calls[0][0];
      expect(shareArg.title).toBe('Test Rug Room Visualization');
      expect(shareArg.text).toBe('Check out how the Test Rug looks in a room!');
    });

    test('passes the share title and message in the configured language, not English', async () => {
      const user = userEvent.setup();
      navigator.share = jest.fn().mockResolvedValue(undefined);
      navigator.canShare = jest.fn().mockReturnValue(true);

      // renderAtResult waits for the English heading, so render directly.
      generateRoomVisualization.mockResolvedValueOnce({
        imageUrl: 'data:image/jpeg;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=',
      });
      render(<RoomVisualizationFlow {...defaultProps} config={{ language: 'sv' }} />);
      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), makeFile());
      });
      await waitFor(() => screen.getByText('Granska ditt nya rum'));
      await user.click(screen.getByText('Spara/Dela'));

      const shareArg = navigator.share.mock.calls[0][0];
      expect(shareArg.title).toBe('Test Rug – rumsvisualisering');
      expect(shareArg.text).toBe('Så här ser Test Rug ut i ett rum!');
    });

    test('a product name containing $ replacement patterns is inserted literally', async () => {
      const user = userEvent.setup();
      navigator.share = jest.fn().mockResolvedValue(undefined);
      navigator.canShare = jest.fn().mockReturnValue(true);

      await renderAtResult(
        { imageUrl: 'data:image/jpeg;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=' },
        { productName: 'Rug $& $1 200x300' }
      );
      await user.click(screen.getByText('Save/Share'));

      expect(navigator.share.mock.calls[0][0].text).toBe(
        'Check out how the Rug $& $1 200x300 looks in a room!'
      );
    });

    test('Share sends the image currently selected via the Before/After toggle, not always the result image', async () => {
      const user = userEvent.setup();
      navigator.share = jest.fn().mockResolvedValue(undefined);
      navigator.canShare = jest.fn().mockReturnValue(true);

      await renderAtResult({ imageUrl: 'data:image/jpeg;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=' });
      // Switch to "Before" -- Download is hidden, so Share is the only
      // way to save/share the currently-displayed image.
      await user.click(screen.getByRole('button', { name: 'Before' }));
      await user.click(screen.getByText('Save/Share'));

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

    test("names the downloaded file with the extension matching the image's own MIME type, not a hardcoded .jpg", async () => {
      // Found in review: triggerDownload used to hardcode '.jpg' regardless
      // of what the data: URI actually contained -- a WebP or PNG result
      // would be saved with a JPEG extension even though the bytes inside
      // were never JPEG. The share path (handleShareWithFriends) already
      // derives its extension from the Blob's own .type; download must too.
      const user = userEvent.setup();
      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});

      await renderAtResult({
        imageUrl: 'data:image/webp;base64,ZmFrZS13ZWJwLWltYWdl',
      });
      await user.click(screen.getByText('Download Image'));

      expect(clickSpy.mock.instances[0].download).toBe('Test Rug-visualization.webp');

      clickSpy.mockRestore();
    });

    test('names the downloaded file .png for a PNG result', async () => {
      const user = userEvent.setup();
      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});

      await renderAtResult({
        imageUrl: 'data:image/png;base64,ZmFrZS1wbmctaW1hZ2U=',
      });
      await user.click(screen.getByText('Download Image'));

      expect(clickSpy.mock.instances[0].download).toBe('Test Rug-visualization.png');

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
      // These tests cover the touch-device path (native share, then the
      // clipboard/download fallbacks); desktop is covered separately below.
      mockPointer(true);
    });
    afterEach(() => {
      console.error = originalConsoleError;
      delete navigator.share;
      delete window.matchMedia;
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

    describe('desktop (no touch screen): "Copy Image" instead of the share sheet', () => {
      beforeEach(() => {
        mockPointer(false);
        toPngBlob.mockClear();
        global.ClipboardItem = class {
          constructor(items) {
            this.items = items;
          }
        };
      });
      afterEach(() => {
        delete navigator.clipboard;
        delete global.ClipboardItem;
      });

      const mockClipboard = write => {
        Object.defineProperty(navigator, 'clipboard', {
          value: { write },
          configurable: true,
        });
      };

      test('labels the button "Copy Image" and copies a PNG to the clipboard, showing "Copied ✓"', async () => {
        const user = userEvent.setup();
        const clipboardWrite = jest.fn().mockResolvedValue(undefined);
        mockClipboard(clipboardWrite);
        const clickSpy = jest
          .spyOn(HTMLAnchorElement.prototype, 'click')
          .mockImplementation(() => {});

        await renderAtResult({ imageUrl: RESULT_DATA_URL });
        const copyButton = screen.getByText('Copy Image');
        await user.click(copyButton);

        expect(clipboardWrite).toHaveBeenCalledTimes(1);
        // The PNG is handed over as a promise (keeps Safari's user
        // activation intact), so resolve it before checking its type.
        const payload = clipboardWrite.mock.calls[0][0][0].items['image/png'];
        // A promise, not an already-awaited blob: awaiting the conversion
        // before constructing the ClipboardItem would lose Safari's user
        // activation.
        expect(typeof payload.then).toBe('function');
        const png = await payload;
        expect(png.type).toBe('image/png');
        // The original (jpeg) image is what gets converted.
        expect(toPngBlob).toHaveBeenCalledTimes(1);
        expect(toPngBlob.mock.calls[0][0].type).toBe('image/jpeg');
        expect(copyButton).toHaveTextContent('Copied ✓');
        expect(clickSpy).not.toHaveBeenCalled();

        clickSpy.mockRestore();
      });

      test('never opens the native share sheet, even when the browser has the Web Share API', async () => {
        const user = userEvent.setup();
        navigator.share = jest.fn().mockResolvedValue(undefined);
        navigator.canShare = jest.fn().mockReturnValue(true);
        mockClipboard(jest.fn().mockResolvedValue(undefined));

        await renderAtResult({ imageUrl: RESULT_DATA_URL });
        await user.click(screen.getByText('Copy Image'));

        expect(navigator.share).not.toHaveBeenCalled();
        delete navigator.canShare;
      });

      test('falls back to downloading when the clipboard write fails, showing "Downloaded ✓"', async () => {
        const user = userEvent.setup();
        mockClipboard(jest.fn().mockRejectedValue(new Error('not allowed')));
        const clickSpy = jest
          .spyOn(HTMLAnchorElement.prototype, 'click')
          .mockImplementation(() => {});

        await renderAtResult({ imageUrl: RESULT_DATA_URL });
        const copyButton = screen.getByText('Copy Image');
        await user.click(copyButton);

        expect(clickSpy).toHaveBeenCalledTimes(1);
        expect(copyButton).toHaveTextContent('Downloaded ✓');

        clickSpy.mockRestore();
      });

      test('falls back to downloading when the browser has no clipboard image API', async () => {
        const user = userEvent.setup();
        delete global.ClipboardItem;
        const clickSpy = jest
          .spyOn(HTMLAnchorElement.prototype, 'click')
          .mockImplementation(() => {});

        await renderAtResult({ imageUrl: RESULT_DATA_URL });
        await user.click(screen.getByText('Copy Image'));

        expect(clickSpy).toHaveBeenCalledTimes(1);

        clickSpy.mockRestore();
      });

      test('still tracks share_clicked', async () => {
        const user = userEvent.setup();
        mockClipboard(jest.fn().mockResolvedValue(undefined));

        await renderAtResult({ imageUrl: RESULT_DATA_URL });
        await user.click(screen.getByText('Copy Image'));

        expect(trackWidgetEvent).toHaveBeenCalledWith(
          undefined,
          'share_clicked',
          expect.any(String),
          'rug-001'
        );
      });
    });

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

  describe('Terms of Use dialog — nested focus trap', () => {
    // Renders ON TOP of the main modal (z-index 10000) -- found in review
    // (PR #115): without its own trap, Tab could move from this overlay's
    // own controls into the underlying, now-covered upload step's controls
    // still present (not unmounted) behind it, and Escape would close the
    // wrong thing (the whole flow) instead of just this overlay.
    const getFocusable = container =>
      Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
        el => getComputedStyle(el).display !== 'none'
      );

    const openTermsDialog = () => {
      render(<RoomVisualizationFlow {...defaultProps} />);
      fireEvent.click(screen.getByText(translations.en.termsLink));
      return screen.getByRole('dialog');
    };

    test("marks itself modal and names itself via its own visible heading, not the covered upload step's", () => {
      // Found in review: role="dialog" alone doesn't tell assistive tech
      // this is the only interactive surface (aria-modal) or give it a name
      // (aria-labelledby) -- without these a screen reader announces an
      // unnamed overlay and may still expose the covered upload step behind it.
      const termsDialog = openTermsDialog();

      expect(termsDialog).toHaveAttribute('aria-modal', 'true');
      const labelledBy = termsDialog.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      expect(document.getElementById(labelledBy)).toHaveTextContent(translations.en.termsTitle);
    });

    test('wraps Tab from its own last focusable element back to its own first, not into the covered upload step behind it', () => {
      const termsDialog = openTermsDialog();
      const focusable = getFocusable(termsDialog);
      expect(focusable.length).toBeGreaterThan(1);
      const [first, last] = [focusable[0], focusable[focusable.length - 1]];

      last.focus();
      fireEvent.keyDown(last, { key: 'Tab' });

      expect(document.activeElement).toBe(first);
      // Also confirms the covered upload step's own controls (e.g. its
      // Upload Photo button) never entered the wrap -- they're still in
      // the DOM (not unmounted), so a non-nesting-aware trap could have
      // wrapped into them instead of staying within the overlay.
      expect(termsDialog.contains(document.activeElement)).toBe(true);
    });

    test('closes only the terms overlay on Escape, leaving the upload step underneath open', () => {
      openTermsDialog();

      fireEvent.keyDown(document.activeElement, { key: 'Escape' });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: new RegExp(translations.en.uploadV2HeaderTitle) })
      ).toBeInTheDocument();
    });

    test('shows the generic (no-partner-name) intro paragraph immediately above section 1, before any section heading', () => {
      const termsDialog = openTermsDialog();

      expect(screen.getByText(translations.en.termsIntro)).toBeInTheDocument();

      const paragraphs = Array.from(termsDialog.querySelectorAll('p, h3'));
      const introIndex = paragraphs.findIndex(el => el.textContent === translations.en.termsIntro);
      const section1Index = paragraphs.findIndex(
        el => el.textContent === translations.en.termsSection1Title
      );
      expect(introIndex).toBeGreaterThanOrEqual(0);
      expect(section1Index).toBeGreaterThan(introIndex);
    });

    test('shows the GDPR/international-standards lead paragraph in section 3, before the cloud-platform body paragraph', () => {
      const termsDialog = openTermsDialog();

      expect(screen.getByText(translations.en.termsSection3Intro)).toBeInTheDocument();

      const paragraphs = Array.from(termsDialog.querySelectorAll('p'));
      const introIndex = paragraphs.findIndex(
        el => el.textContent === translations.en.termsSection3Intro
      );
      const bodyIndex = paragraphs.findIndex(
        el => el.textContent === translations.en.termsSection3Body
      );
      expect(introIndex).toBeGreaterThanOrEqual(0);
      expect(bodyIndex).toBeGreaterThan(introIndex);
    });
  });

  describe('terms dialog — full privacy policy link', () => {
    const openTermsDialogWith = props => {
      render(<RoomVisualizationFlow {...defaultProps} {...props} />);
      const lang = props.config?.language ?? 'en';
      fireEvent.click(screen.getByText(translations[lang].termsLink));
      return screen.getByRole('dialog');
    };

    test('links to getroomly.ai/privacy?lang=en by default, opened in a new tab', () => {
      const termsDialog = openTermsDialogWith({});

      const link = within(termsDialog).getByText(translations.en.termsFullPolicyLink);
      expect(link).toHaveAttribute('href', 'https://getroomly.ai/privacy?lang=en');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    test('links to the Swedish tab (?lang=sv) when the widget itself is Swedish', () => {
      // getroomly.ai/privacy only has sv/en -- Swedish shoppers deep-link to
      // the Swedish tab, every other one of this widget's 16 languages falls
      // back to English (see the non-Swedish case below).
      const termsDialog = openTermsDialogWith({ config: { language: 'sv' } });

      const link = within(termsDialog).getByText(translations.sv.termsFullPolicyLink);
      expect(link).toHaveAttribute('href', 'https://getroomly.ai/privacy?lang=sv');
    });

    test('falls back to the English tab for a non-Swedish widget language the policy page does not have', () => {
      const termsDialog = openTermsDialogWith({ config: { language: 'ja' } });

      const link = within(termsDialog).getByText(translations.ja.termsFullPolicyLink);
      expect(link).toHaveAttribute('href', 'https://getroomly.ai/privacy?lang=en');
    });
  });

  describe('"Powered by GetRoomly" footer credit (result step)', () => {
    const renderAtResult = async (props = {}) => {
      generateRoomVisualization.mockResolvedValueOnce({
        imageUrl: 'data:image/jpeg;base64,result',
      });
      render(<RoomVisualizationFlow {...defaultProps} {...props} />);
      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), makeFile());
      });
      // The step-1 heading's own text is localized (e.g. Swedish reads
      // "Granska ditt nya rum", not this literal English string) -- waiting
      // for the always-English "Powered by GetRoomly" credit itself is a
      // reliable, language-agnostic way to know the result step finished
      // rendering regardless of which config.language a given test passes.
      await waitFor(() => screen.getByText('Powered by GetRoomly'));
    };

    test('shows the literal, untranslated "Powered by GetRoomly" text even when the rest of the UI is localized', async () => {
      // Explicit instruction: this string is NOT part of the t.xyz
      // translation dictionary and must read identically in every
      // language -- config.language: 'sv' proves both halves at once, since
      // Swedish strings (like newPhoto below) ARE genuinely localized
      // elsewhere on the very same screen.
      await renderAtResult({ config: { language: 'sv' } });

      expect(screen.getByText('Powered by GetRoomly')).toBeInTheDocument();
      expect(screen.getByText('Nytt foto')).toBeInTheDocument();
    });

    test('uses the same muted colour token as the tertiary row above it, so it stays consistent across brand themes without its own override', async () => {
      // --getroomly-tertiary-text is already what Share/New Photo (rendered
      // right above this) use, and is already flattened to black in
      // brand.ts for Nordic Nest/Svensson -- reusing it here means this
      // credit line automatically matches whatever theme is active, with
      // no new per-brand colour needed.
      const colorSpy = captureStyleSetterCalls('color');
      await renderAtResult();
      colorSpy.restore();

      const credit = screen.getByText('Powered by GetRoomly');
      expect(colorSpy.valuesFor(credit)).toEqual(['var(--getroomly-tertiary-text)']);
    });

    test("is absolutely positioned against the footer's own existing bottom padding, not a new flex row that would grow the footer", async () => {
      // Found in review (Markus): an earlier version added this as a normal
      // flex child of the button row's column, which grew the footer's
      // total height beyond what existed before it -- since the room
      // photo's own size is measured live against whatever height the
      // footer leaves it (see resultContentRef's effect), that shrank the
      // photo. Absolute positioning spends the SAME padding band that was
      // already there below the buttons instead of adding to it, so the
      // button row's own spacing and the photo's size are both unaffected.
      await renderAtResult();
      const credit = screen.getByText('Powered by GetRoomly');
      const newPhotoButton = screen.getByText('New Photo');

      expect(credit.style.position).toBe('absolute');
      // A sibling of the button row's own flex column, not nested inside
      // it -- so it never participates in that column's own `gap` and
      // can't add to its height.
      const buttonRowColumn = newPhotoButton.closest('div[style*="flex-direction: column"]');
      expect(buttonRowColumn).not.toBeNull();
      expect(credit.parentElement).not.toBe(buttonRowColumn);
      expect(credit.parentElement).toBe(buttonRowColumn.parentElement);
    });

    test('sits 4px from the widget edge -- the same gap already used between the disclaimer and the button row above it', async () => {
      // Found in review (Markus): measured (not guessed) the real gap
      // between the disclaimer and the button row above it -- 8px column
      // gap minus the disclaimer's own -4px margin = 4px net -- then
      // applied that SAME value symmetrically around this line's own
      // 11px height, both above (from the button row) and below (to the
      // widget's own edge), instead of the arbitrary leftover space the
      // previous version left.
      await renderAtResult();
      const credit = screen.getByText('Powered by GetRoomly');
      expect(credit.style.bottom).toBe('4px');
    });

    test("widens the footer's bottom padding only on the result step -- upload and processing never show this credit line, so their padding is untouched", () => {
      // The credit line and the upload/processing footers all share ONE
      // wrapper div (see the main return) -- without scoping the padding
      // change to step==='result', it would have silently grown those two
      // unrelated footers' bottom padding too. D2 redesign: the upload
      // step's own trust/hint lines now live inside renderUploadStep
      // itself, so this shared footer renders nothing and gets padding:0
      // there -- still a value the result-step-only 19px change must never
      // leak into.
      const { container } = render(<RoomVisualizationFlow {...defaultProps} />);
      const uploadStepRoot = container.querySelector('.getroomly-upload-step');
      const uploadFooter = uploadStepRoot.parentElement.nextElementSibling;
      expect(uploadFooter).not.toBeNull();
      expect(uploadFooter.style.padding).toBe('0px');
    });

    test("widens the result step's own footer padding to exactly 19px on the bottom", async () => {
      // Found in review: the previous test only proved the OTHER steps'
      // padding is untouched -- this directly asserts the result step's
      // own footer actually got the new, deliberately-sized value (4px
      // gap + 11px credit line + 4px gap = 19px), not just "not the old
      // one".
      const paddingSpy = captureStyleSetterCalls('padding');
      await renderAtResult();
      paddingSpy.restore();

      const newPhotoButton = screen.getByText('New Photo');
      const resultFooter = newPhotoButton.closest('div[style*="flex-shrink: 0"]');
      expect(resultFooter).not.toBeNull();
      const values = paddingSpy.valuesFor(resultFooter);
      expect(values.at(-1)).toBe('8px var(--getroomly-space-sm) 19px');
    });
  });

  // ─── Widget UX-funnel event tracking (backend /v1/event) ──────────────────
  // Distinct from the GA4 tracking in lib/analytics.ts (widget_opened/closed
  // there is fired from App.tsx, keyed on config.sku, aimed at a partner's
  // own attribution report). These are GetRoomly's own funnel events, all
  // sharing this component's own sessionId so a session can be reconstructed
  // end to end.

  describe('widget UX-funnel event tracking', () => {
    test("fires widget_opened on mount, with this session's sessionId and productId", () => {
      render(<RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />);

      expect(trackWidgetEvent).toHaveBeenCalledWith(
        'partner-abc',
        'widget_opened',
        expect.any(String),
        'rug-001'
      );
    });

    test('fires widget_closed on unmount, with the SAME sessionId widget_opened used', () => {
      const { unmount } = render(
        <RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />
      );

      const openedSessionId = trackWidgetEvent.mock.calls.find(
        call => call[1] === 'widget_opened'
      )[2];
      trackWidgetEvent.mockClear();

      unmount();

      expect(trackWidgetEvent).toHaveBeenCalledWith(
        'partner-abc',
        'widget_closed',
        openedSessionId,
        'rug-001'
      );
    });

    test('does not re-fire widget_closed/widget_opened when config/productId change while still mounted', () => {
      // Regression test: App.tsx renders this component with no `key`, and
      // useEmbedConfig can re-read config (new apiKey/productId) on a
      // 'getroomly-open-modal' event without remounting it — a live config
      // swap on an instance that never actually closed and reopened.
      const { rerender } = render(
        <RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />
      );
      trackWidgetEvent.mockClear();

      rerender(
        <RoomVisualizationFlow
          {...defaultProps}
          productId="rug-002"
          config={{ apiKey: 'partner-xyz' }}
        />
      );

      expect(trackWidgetEvent).not.toHaveBeenCalledWith(
        expect.anything(),
        'widget_closed',
        expect.anything(),
        expect.anything()
      );
      expect(trackWidgetEvent).not.toHaveBeenCalledWith(
        expect.anything(),
        'widget_opened',
        expect.anything(),
        expect.anything()
      );
    });

    test('widget_closed uses the ORIGINAL apiKey/productId, not a value swapped in after widget_opened', () => {
      // Regression test: found in review of the fix above. The cleanup must
      // capture identity at effect-setup time, not re-read a mutable ref at
      // actual unmount time -- otherwise a live config swap that happens
      // between open and close pairs widget_opened's original identity with
      // widget_closed's NEW one under the same sessionId, splitting one
      // lifecycle across two partners/products.
      const { rerender, unmount } = render(
        <RoomVisualizationFlow
          {...defaultProps}
          productId="rug-001"
          config={{ apiKey: 'partner-abc' }}
        />
      );
      const openedSessionId = trackWidgetEvent.mock.calls.find(
        call => call[1] === 'widget_opened'
      )[2];

      rerender(
        <RoomVisualizationFlow
          {...defaultProps}
          productId="rug-002"
          config={{ apiKey: 'partner-xyz' }}
        />
      );

      unmount();

      expect(trackWidgetEvent).toHaveBeenCalledWith(
        'partner-abc',
        'widget_closed',
        openedSessionId,
        'rug-001'
      );
    });

    test('fires terms_clicked when the terms link is clicked', () => {
      render(<RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />);
      trackWidgetEvent.mockClear();

      fireEvent.click(screen.getByText(translations.en.termsLink));

      expect(trackWidgetEvent).toHaveBeenCalledWith(
        'partner-abc',
        'terms_clicked',
        expect.any(String),
        'rug-001'
      );
    });

    test('fires upload_clicked when the dropzone is clicked', () => {
      const { container } = render(
        <RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />
      );
      trackWidgetEvent.mockClear();

      fireEvent.click(container.querySelector('[style*="cursor: pointer"]'));

      expect(trackWidgetEvent).toHaveBeenCalledWith(
        'partner-abc',
        'upload_clicked',
        expect.any(String),
        'rug-001'
      );
    });

    test('fires upload_clicked on a drag-and-drop upload too, not just the click path', () => {
      const { container } = render(
        <RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />
      );
      trackWidgetEvent.mockClear();

      const dropzone = container.querySelector('[style*="cursor: pointer"]');
      fireEvent.drop(dropzone, { dataTransfer: { files: [makeFile()] } });

      expect(trackWidgetEvent).toHaveBeenCalledWith(
        'partner-abc',
        'upload_clicked',
        expect.any(String),
        'rug-001'
      );
    });

    test('clears the file input value synchronously on every selection, so re-picking the identical file fires change rather than a false native cancel', async () => {
      // Found in review (Copilot, PR #138): a file input only fires
      // 'change' again if its value actually differs -- re-selecting the
      // SAME file (e.g. retrying after an unrelated backend error) leaves
      // it unchanged, so the browser fires 'cancel' instead, which would
      // otherwise be wrongly recorded as upload_cancelled despite a real
      // photo being chosen. This can't be verified by the browser's own
      // cancel-vs-change decision in jsdom (it doesn't implement that
      // heuristic), so this instead confirms OUR half of the fix is in
      // place: the value is cleared synchronously, independent of whether
      // the read that follows succeeds or fails.
      //
      // Asserting input.value === '' afterward (an earlier version of this
      // test) was vacuous (found in review, Copilot PR #138): uploadFile
      // only ever defines `files`, so jsdom leaves `value` at its default
      // '' regardless of whether the production code's reset line exists
      // at all -- the assertion would pass either way. A real browser also
      // refuses to let JS set a NON-empty value on a file input (verified:
      // throws "may only be programmatically set to the empty string"), so
      // this instead spies on the underlying setter itself -- proving the
      // reset actually ran, independent of jsdom's starting value.
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      const setValueCalls = [];
      Object.defineProperty(HTMLInputElement.prototype, 'value', {
        configurable: true,
        get: descriptor.get,
        set(value) {
          setValueCalls.push({ element: this, value });
          descriptor.set.call(this, value);
        },
      });

      try {
        render(<RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />);
        const input = document.querySelector('input[type="file"]');

        await act(async () => {
          uploadFile(input, makeFile());
        });

        expect(setValueCalls.filter(c => c.element === input).map(c => c.value)).toContain('');
      } finally {
        Object.defineProperty(HTMLInputElement.prototype, 'value', descriptor);
      }
    });

    test('fires upload_completed after a successful file read, before generation starts', async () => {
      render(<RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />);
      trackWidgetEvent.mockClear();

      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), makeFile());
      });

      expect(trackWidgetEvent).toHaveBeenCalledWith(
        'partner-abc',
        'upload_completed',
        expect.any(String),
        'rug-001'
      );
    });

    test('does not fire upload_completed when file validation fails', async () => {
      validateImageFile.mockReturnValueOnce({ isValid: false, error: 'nope' });
      render(<RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />);
      trackWidgetEvent.mockClear();

      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), makeFile());
      });

      expect(trackWidgetEvent).not.toHaveBeenCalledWith(
        expect.anything(),
        'upload_completed',
        expect.anything(),
        expect.anything()
      );
    });

    describe('upload_cancelled (file picker opened but no photo chosen)', () => {
      // Primary signal is the file input's own standard 'cancel' event
      // (fires exactly when the native picker is dismissed without a
      // selection -- see the two tests right below). The focus/visibility
      // tests further down exercise the FALLBACK path in isolation, by
      // never firing 'cancel' at all -- that's deliberate, not an oversight:
      // it's what lets them prove the fallback alone is still sufficient.
      afterEach(() => {
        jest.useRealTimers();
        // Removes the own-property override set by setVisibilityState below,
        // so jsdom's own (prototype) getter -- reporting 'visible' -- shows
        // through again for every other test in this file.
        delete document.visibilityState;
      });

      const setVisibilityState = value => {
        Object.defineProperty(document, 'visibilityState', {
          value,
          configurable: true,
        });
      };

      test('fires upload_cancelled immediately via the native file-input cancel event', () => {
        // Found in review (Copilot, PR #137): <input type="file"> has a
        // standard 'cancel' event, fired exactly when the native picker is
        // dismissed without a selection -- within this project's stated
        // evergreen-current+1 browser support matrix (README.md), it's the
        // primary signal, not the focus/visibility fallback below.
        const { container } = render(
          <RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />
        );
        trackWidgetEvent.mockClear();

        fireEvent.click(container.querySelector('[style*="cursor: pointer"]'));
        trackWidgetEvent.mockClear(); // drop the upload_clicked call from above

        const input = document.querySelector('input[type="file"]');
        fireEvent(input, new Event('cancel', { bubbles: true }));

        expect(trackWidgetEvent).toHaveBeenCalledWith(
          'partner-abc',
          'upload_cancelled',
          expect.any(String),
          'rug-001'
        );
      });

      test('fires upload_cancelled via the native cancel event on the REPLACEMENT input after New Photo remounts it', async () => {
        // Regression for Copilot review on PR #138: the callback ref exists
        // specifically because the file input unmounts/remounts across
        // "New Photo" -- this proves the listener actually gets attached to
        // the NEW node, not left dangling on the original (now-detached)
        // one dispatching 'cancel' there would prove nothing).
        generateRoomVisualization.mockResolvedValueOnce({ imageUrl: 'blob:result' });
        const { container } = render(
          <RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />
        );
        const originalInput = document.querySelector('input[type="file"]');

        await act(async () => {
          uploadFile(originalInput, makeFile());
        });
        await waitFor(() => screen.getByText('Review Your New Room'));

        await act(async () => {
          fireEvent.click(screen.getByText('New Photo'));
        });

        const replacementInput = document.querySelector('input[type="file"]');
        expect(replacementInput).not.toBe(originalInput);

        fireEvent.click(container.querySelector('[style*="cursor: pointer"]'));
        trackWidgetEvent.mockClear(); // drop upload_clicked

        fireEvent(replacementInput, new Event('cancel', { bubbles: true }));

        expect(trackWidgetEvent).toHaveBeenCalledWith(
          'partner-abc',
          'upload_cancelled',
          expect.any(String),
          'rug-001'
        );
      });

      test('does not double-report when the native cancel event is followed by a focus event for the same dismissal', () => {
        const { container } = render(
          <RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />
        );
        trackWidgetEvent.mockClear();

        fireEvent.click(container.querySelector('[style*="cursor: pointer"]'));
        trackWidgetEvent.mockClear();

        const input = document.querySelector('input[type="file"]');
        fireEvent(input, new Event('cancel', { bubbles: true }));

        jest.useFakeTimers();
        act(() => {
          window.dispatchEvent(new Event('focus'));
          jest.advanceTimersByTime(300);
        });

        const cancelCalls = trackWidgetEvent.mock.calls.filter(
          call => call[1] === 'upload_cancelled'
        );
        expect(cancelCalls).toHaveLength(1);
      });

      test('fires upload_cancelled once the picker-closed grace period elapses with no file chosen', () => {
        const { container } = render(
          <RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />
        );
        trackWidgetEvent.mockClear();

        fireEvent.click(container.querySelector('[style*="cursor: pointer"]'));
        trackWidgetEvent.mockClear(); // drop the upload_clicked call from above

        jest.useFakeTimers();
        act(() => {
          window.dispatchEvent(new Event('focus'));
          jest.advanceTimersByTime(300);
        });

        expect(trackWidgetEvent).toHaveBeenCalledWith(
          'partner-abc',
          'upload_cancelled',
          expect.any(String),
          'rug-001'
        );
      });

      test('does not fire upload_cancelled when a file was actually chosen before focus returns', async () => {
        const { container } = render(
          <RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />
        );
        trackWidgetEvent.mockClear();

        fireEvent.click(container.querySelector('[style*="cursor: pointer"]'));
        trackWidgetEvent.mockClear();

        await act(async () => {
          uploadFile(document.querySelector('input[type="file"]'), makeFile());
        });

        jest.useFakeTimers();
        act(() => {
          window.dispatchEvent(new Event('focus'));
          jest.advanceTimersByTime(300);
        });

        expect(trackWidgetEvent).not.toHaveBeenCalledWith(
          expect.anything(),
          'upload_cancelled',
          expect.anything(),
          expect.anything()
        );
      });

      test('does not fire upload_cancelled for the drag-and-drop path, which never opens the native picker', () => {
        const { container } = render(
          <RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />
        );
        trackWidgetEvent.mockClear();

        const dropzone = container.querySelector('[style*="cursor: pointer"]');
        fireEvent.drop(dropzone, { dataTransfer: { files: [makeFile()] } });
        trackWidgetEvent.mockClear();

        jest.useFakeTimers();
        act(() => {
          window.dispatchEvent(new Event('focus'));
          jest.advanceTimersByTime(300);
        });

        expect(trackWidgetEvent).not.toHaveBeenCalledWith(
          expect.anything(),
          'upload_cancelled',
          expect.anything(),
          expect.anything()
        );
      });

      test('fires upload_cancelled via visibilitychange too, not just focus -- the more reliable signal on mobile browsers', () => {
        const { container } = render(
          <RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />
        );
        trackWidgetEvent.mockClear();

        fireEvent.click(container.querySelector('[style*="cursor: pointer"]'));
        trackWidgetEvent.mockClear();

        setVisibilityState('visible');
        jest.useFakeTimers();
        act(() => {
          document.dispatchEvent(new Event('visibilitychange'));
          jest.advanceTimersByTime(300);
        });

        expect(trackWidgetEvent).toHaveBeenCalledWith(
          'partner-abc',
          'upload_cancelled',
          expect.any(String),
          'rug-001'
        );
      });

      test('does not fire on visibilitychange while the document is becoming hidden, only when it becomes visible again', () => {
        const { container } = render(
          <RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />
        );
        trackWidgetEvent.mockClear();

        fireEvent.click(container.querySelector('[style*="cursor: pointer"]'));
        trackWidgetEvent.mockClear();

        setVisibilityState('hidden');
        jest.useFakeTimers();
        act(() => {
          document.dispatchEvent(new Event('visibilitychange'));
          jest.advanceTimersByTime(300);
        });

        expect(trackWidgetEvent).not.toHaveBeenCalledWith(
          expect.anything(),
          'upload_cancelled',
          expect.anything(),
          expect.anything()
        );
      });

      test('reports upload_cancelled only once even if both focus and visibilitychange fire for the same cancel', () => {
        const { container } = render(
          <RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />
        );
        trackWidgetEvent.mockClear();

        fireEvent.click(container.querySelector('[style*="cursor: pointer"]'));
        trackWidgetEvent.mockClear();

        setVisibilityState('visible');
        jest.useFakeTimers();
        act(() => {
          document.dispatchEvent(new Event('visibilitychange'));
          window.dispatchEvent(new Event('focus'));
          jest.advanceTimersByTime(300);
        });

        const cancelCalls = trackWidgetEvent.mock.calls.filter(
          call => call[1] === 'upload_cancelled'
        );
        expect(cancelCalls).toHaveLength(1);
      });

      test("does not let a stale grace timeout from a cancelled attempt swallow a newer attempt's own cancellation", () => {
        // Regression for Copilot review on PR #135: reopening the picker
        // (attempt 2) while attempt 1's 300ms grace timeout is still
        // pending used to let that stale timeout see filePickerPendingRef
        // freshly set to true by attempt 2, wrongly report+clear it for
        // attempt 1, and so silently swallow attempt 2's own later cancel.
        const { container } = render(
          <RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />
        );
        trackWidgetEvent.mockClear();

        // Attempt 1: open the picker, then cancel it -- schedules a grace timeout.
        fireEvent.click(container.querySelector('[style*="cursor: pointer"]'));
        trackWidgetEvent.mockClear();

        jest.useFakeTimers();
        act(() => {
          window.dispatchEvent(new Event('focus'));
        });

        // Before attempt 1's grace period elapses, the shopper reopens the
        // picker -- attempt 2.
        act(() => {
          jest.advanceTimersByTime(100);
          fireEvent.click(container.querySelector('[style*="cursor: pointer"]'));
        });
        trackWidgetEvent.mockClear(); // drop attempt 2's own upload_clicked call

        // Attempt 1's stale timeout fires now (300ms from ITS OWN schedule,
        // i.e. 200ms from here) -- must no-op instead of mis-reporting.
        act(() => {
          jest.advanceTimersByTime(200);
        });
        expect(trackWidgetEvent).not.toHaveBeenCalledWith(
          expect.anything(),
          'upload_cancelled',
          expect.anything(),
          expect.anything()
        );

        // The shopper now cancels attempt 2 for real -- this must still be
        // reported, not silently swallowed by attempt 1's stale timeout.
        act(() => {
          window.dispatchEvent(new Event('focus'));
          jest.advanceTimersByTime(300);
        });
        expect(trackWidgetEvent).toHaveBeenCalledWith(
          'partner-abc',
          'upload_cancelled',
          expect.any(String),
          'rug-001'
        );
      });

      test('does not fire after unmount, even if focus returns while a picker was left open', () => {
        const { container, unmount } = render(
          <RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />
        );
        trackWidgetEvent.mockClear();

        fireEvent.click(container.querySelector('[style*="cursor: pointer"]'));
        trackWidgetEvent.mockClear();

        unmount();

        jest.useFakeTimers();
        act(() => {
          window.dispatchEvent(new Event('focus'));
          jest.advanceTimersByTime(300);
        });

        expect(trackWidgetEvent).not.toHaveBeenCalledWith(
          expect.anything(),
          'upload_cancelled',
          expect.anything(),
          expect.anything()
        );
      });
    });

    test('fires result_viewed once the result step is actually shown', async () => {
      generateRoomVisualization.mockResolvedValueOnce({ imageUrl: 'blob:result' });
      render(<RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />);
      trackWidgetEvent.mockClear();

      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), makeFile());
      });

      await waitFor(() => {
        expect(trackWidgetEvent).toHaveBeenCalledWith(
          'partner-abc',
          'result_viewed',
          expect.any(String),
          'rug-001'
        );
      });
    });

    test('does not re-fire result_viewed when config/productId change while already on the result step', async () => {
      // Same live-config-swap scenario as the widget_opened/closed
      // regression test above, but hitting the result step's effect instead.
      generateRoomVisualization.mockResolvedValueOnce({ imageUrl: 'blob:result' });
      const { rerender } = render(
        <RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />
      );

      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), makeFile());
      });
      await waitFor(() => {
        expect(trackWidgetEvent).toHaveBeenCalledWith(
          'partner-abc',
          'result_viewed',
          expect.any(String),
          'rug-001'
        );
      });
      trackWidgetEvent.mockClear();

      rerender(
        <RoomVisualizationFlow
          {...defaultProps}
          productId="rug-002"
          config={{ apiKey: 'partner-xyz' }}
        />
      );

      expect(trackWidgetEvent).not.toHaveBeenCalledWith(
        expect.anything(),
        'result_viewed',
        expect.anything(),
        expect.anything()
      );
    });

    test('only fires result_viewed after the result DOM has actually committed', async () => {
      generateRoomVisualization.mockResolvedValueOnce({ imageUrl: 'blob:result' });
      let resultVisibleAtCallTime = null;
      trackWidgetEvent.mockImplementation((...args) => {
        if (args[1] === 'result_viewed') {
          resultVisibleAtCallTime = screen.queryByText('New Photo') !== null;
        }
      });
      render(<RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />);

      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), makeFile());
      });

      await waitFor(() => {
        expect(resultVisibleAtCallTime).not.toBeNull();
      });
      expect(resultVisibleAtCallTime).toBe(true);
    });

    test('does not fire result_viewed when generation fails', async () => {
      generateRoomVisualization.mockRejectedValueOnce(new Error('boom'));
      render(<RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />);
      trackWidgetEvent.mockClear();

      await act(async () => {
        uploadFile(document.querySelector('input[type="file"]'), makeFile());
      });

      await waitFor(() => {
        expect(trackWidgetEvent).not.toHaveBeenCalledWith(
          expect.anything(),
          'result_viewed',
          expect.anything(),
          expect.anything()
        );
      });
    });

    // Result-screen purchase-intent actions (found in review with Markus:
    // these only reached the host page via config.callbacks before this --
    // invisible to GetRoomly's own funnel). Each test only checks the
    // trackWidgetEvent call itself; the buttons' own mechanics (blob
    // conversion, navigator.share, download link) are already covered
    // elsewhere in this file.
    describe('result-screen purchase-intent events', () => {
      const RESULT_DATA_URL = 'data:image/jpeg;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=';

      const renderAtResult = async () => {
        generateRoomVisualization.mockResolvedValueOnce({ imageUrl: RESULT_DATA_URL });
        render(<RoomVisualizationFlow {...defaultProps} config={{ apiKey: 'partner-abc' }} />);
        await act(async () => {
          uploadFile(document.querySelector('input[type="file"]'), makeFile());
        });
        await waitFor(() => screen.getByText('Review Your New Room'));
        trackWidgetEvent.mockClear();
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

      test('fires add_to_basket_clicked when Add to Basket is clicked', async () => {
        await renderAtResult();

        fireEvent.click(screen.getByText('Add to Basket'));

        expect(trackWidgetEvent).toHaveBeenCalledWith(
          'partner-abc',
          'add_to_basket_clicked',
          expect.any(String),
          'rug-001'
        );
      });

      test('fires favorite_clicked when the favorite button is clicked', async () => {
        await renderAtResult();

        fireEvent.click(screen.getByRole('button', { name: 'Save to favourites' }));

        expect(trackWidgetEvent).toHaveBeenCalledWith(
          'partner-abc',
          'favorite_clicked',
          expect.any(String),
          'rug-001'
        );
      });

      test('fires download_clicked when Download Image is clicked', async () => {
        const user = userEvent.setup();
        global.URL.createObjectURL.mockReturnValueOnce('blob:mock-download-url');
        const clickSpy = jest
          .spyOn(HTMLAnchorElement.prototype, 'click')
          .mockImplementation(() => {});
        await renderAtResult();

        await user.click(screen.getByText('Download Image'));

        expect(trackWidgetEvent).toHaveBeenCalledWith(
          'partner-abc',
          'download_clicked',
          expect.any(String),
          'rug-001'
        );
        clickSpy.mockRestore();
      });

      test('fires share_clicked when Share is clicked', async () => {
        const user = userEvent.setup();
        mockPointer(true);
        navigator.share = jest.fn().mockResolvedValue(undefined);
        await renderAtResult();

        await user.click(screen.getByText('Share'));

        expect(trackWidgetEvent).toHaveBeenCalledWith(
          'partner-abc',
          'share_clicked',
          expect.any(String),
          'rug-001'
        );
      });
    });
  });
});
