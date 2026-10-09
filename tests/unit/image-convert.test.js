import { toPngBlob } from '../../src/lib/image-convert';

// jsdom has neither createImageBitmap nor a working canvas, so both are
// stubbed; what is under test is the wiring: what gets drawn, which type is
// requested, and that the bitmap is always released.
describe('toPngBlob', () => {
  let bitmap;
  let context;
  let canvas;
  let createElementSpy;

  const webp = () => new Blob(['webp-bytes'], { type: 'image/webp' });

  beforeEach(() => {
    bitmap = { width: 64, height: 48, close: jest.fn() };
    global.createImageBitmap = jest.fn().mockResolvedValue(bitmap);
    context = { drawImage: jest.fn() };
    canvas = {
      width: 0,
      height: 0,
      getContext: jest.fn(() => context),
      toBlob: jest.fn(callback => callback(new Blob(['png-bytes'], { type: 'image/png' }))),
    };
    const realCreateElement = document.createElement.bind(document);
    createElementSpy = jest
      .spyOn(document, 'createElement')
      .mockImplementation(tag => (tag === 'canvas' ? canvas : realCreateElement(tag)));
  });

  afterEach(() => {
    createElementSpy.mockRestore();
    delete global.createImageBitmap;
  });

  test('returns a PNG unchanged, without decoding or drawing anything', async () => {
    const png = new Blob(['already-png'], { type: 'image/png' });

    await expect(toPngBlob(png)).resolves.toBe(png);

    expect(global.createImageBitmap).not.toHaveBeenCalled();
    expect(canvas.getContext).not.toHaveBeenCalled();
  });

  test('draws the decoded image onto a canvas of the same size and encodes it as image/png', async () => {
    const input = webp();

    const result = await toPngBlob(input);

    expect(global.createImageBitmap).toHaveBeenCalledWith(input);
    expect(canvas.width).toBe(64);
    expect(canvas.height).toBe(48);
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
    expect(result.type).toBe('image/png');
  });

  test('releases the bitmap after a successful conversion', async () => {
    await toPngBlob(webp());

    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  test('rejects, and still releases the bitmap, when PNG encoding returns null', async () => {
    canvas.toBlob = jest.fn(callback => callback(null));

    await expect(toPngBlob(webp())).rejects.toThrow('PNG encoding failed');

    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  test('rejects, and still releases the bitmap, when no 2D context is available', async () => {
    canvas.getContext = jest.fn(() => null);

    await expect(toPngBlob(webp())).rejects.toThrow('2D canvas is unavailable');

    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  test('rejects when the image cannot be decoded (nothing to release)', async () => {
    global.createImageBitmap = jest.fn().mockRejectedValue(new Error('bad image'));

    await expect(toPngBlob(webp())).rejects.toThrow('bad image');

    expect(canvas.getContext).not.toHaveBeenCalled();
  });
});
