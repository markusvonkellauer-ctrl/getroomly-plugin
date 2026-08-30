/**
 * RoomVisualizationFlow Component Tests
 *
 * Covers the new coordinate-free upload → processing → result flow.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { RoomVisualizationFlow } from '../../src/components/RoomVisualizationFlow';

jest.mock('../../src/services/ai-generation', () => ({
  generateRoomVisualization: jest.fn(),
  submitFeedback: jest.fn(),
  validateImageFile: jest.fn(() => ({ isValid: true, error: null })),
}));

import {
  generateRoomVisualization,
  submitFeedback,
  validateImageFile,
} from '../../src/services/ai-generation';

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
  Object.defineProperty(input, 'files', { value: [file], writable: false });
  fireEvent.change(input);
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

      // Still renders the result step — a failed feedback POST must never break the UI.
      expect(screen.getByText('Review Your New Room')).toBeInTheDocument();
    });
  });
});
