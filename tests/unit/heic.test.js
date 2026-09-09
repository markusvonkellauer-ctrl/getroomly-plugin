/**
 * HEIC detection/conversion tests
 *
 * isHeicFile reads a file via FileReader.readAsArrayBuffer — jsdom's Blob
 * has no .arrayBuffer()/.text()/.stream() at all (verified empirically),
 * and the global FileReader mock in tests/setup.js always resolves with an
 * empty buffer (deliberately, so it never accidentally flags any existing
 * test's fixture files as HEIC). So each test below swaps in its own
 * FileReader mock that resolves with specific bytes, ignoring whatever
 * File/Blob is actually passed in — isHeicFile's own byte-parsing logic is
 * what's under test here, not the browser's file-reading plumbing (that's
 * covered by the integration tests in room-visualization-flow.test.jsx,
 * which exercise the real call path end-to-end against the default mock).
 */

import { isHeicFile, convertHeicToJpeg } from '../../src/lib/heic';

function mockFileReaderReturning(bytes) {
  return class {
    readAsArrayBuffer() {
      const buffer = new Uint8Array(bytes).buffer;
      queueMicrotask(() => {
        this.result = buffer;
        this.onload?.();
      });
    }
  };
}

function withMockFileReader(bytes, fn) {
  const RealFileReader = global.FileReader;
  global.FileReader = mockFileReaderReturning(bytes);
  return fn().finally(() => {
    global.FileReader = RealFileReader;
  });
}

const ftypBox = brand => [
  0,
  0,
  0,
  24, // box size — arbitrary, not checked
  ...'ftyp'.split('').map(c => c.charCodeAt(0)),
  ...brand.split('').map(c => c.charCodeAt(0)),
];

const dummyFile = () => new File(['ignored — mock reader supplies the bytes'], 'photo');

describe('isHeicFile', () => {
  it.each(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'])(
    'recognizes the %s HEIC/HEIF brand',
    brand =>
      withMockFileReader(ftypBox(brand), async () => {
        expect(await isHeicFile(dummyFile())).toBe(true);
      })
  );

  it('returns false for a real JPEG signature (0xFFD8FF...)', () =>
    withMockFileReader(
      [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1],
      async () => {
        expect(await isHeicFile(dummyFile())).toBe(false);
      }
    ));

  it('returns false for a real PNG signature', () =>
    withMockFileReader([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0], async () => {
      expect(await isHeicFile(dummyFile())).toBe(false);
    }));

  it('returns false for an ftyp box with a non-HEIC brand (e.g. a plain MP4)', () =>
    withMockFileReader(ftypBox('isom'), async () => {
      expect(await isHeicFile(dummyFile())).toBe(false);
    }));

  it('returns false when fewer than 12 bytes are available', () =>
    withMockFileReader([0, 0, 0, 24, 102, 116, 121, 112], async () => {
      expect(await isHeicFile(dummyFile())).toBe(false);
    }));
});

describe('convertHeicToJpeg', () => {
  const mockHeic2any = jest.fn();
  jest.mock('heic2any', () => ({ __esModule: true, default: (...args) => mockHeic2any(...args) }));

  beforeEach(() => {
    mockHeic2any.mockReset();
  });

  it('converts via heic2any and returns a File named *.jpg with type image/jpeg', async () => {
    const convertedBlob = new Blob(['converted'], { type: 'image/jpeg' });
    mockHeic2any.mockResolvedValue(convertedBlob);

    const source = new File(['heic bytes'], 'IMG_1234.HEIC', { type: 'image/heic' });
    const result = await convertHeicToJpeg(source);

    expect(mockHeic2any).toHaveBeenCalledWith({
      blob: source,
      toType: 'image/jpeg',
      quality: 0.85,
    });
    expect(result).toBeInstanceOf(File);
    expect(result.name).toBe('IMG_1234.jpg');
    expect(result.type).toBe('image/jpeg');
  });

  it('takes the first blob when heic2any returns an array (multi-image HEIC)', async () => {
    // jsdom's Blob has no .text()/.arrayBuffer() to assert on content
    // directly (verified empirically — see the file-level comment above),
    // so distinctly-sized content is used to tell "first" and "second"
    // apart via .size, which jsdom does support.
    const first = new Blob(['first-blob-content'], { type: 'image/jpeg' });
    const second = new Blob(['second'], { type: 'image/jpeg' });
    mockHeic2any.mockResolvedValue([first, second]);

    const result = await convertHeicToJpeg(new File(['x'], 'burst.heic'));

    expect(result.size).toBe(first.size);
  });

  it('propagates a conversion failure so the caller can fall back', async () => {
    mockHeic2any.mockRejectedValue(new Error('decode failed'));

    await expect(convertHeicToJpeg(new File(['x'], 'broken.heic'))).rejects.toThrow(
      'decode failed'
    );
  });
});
