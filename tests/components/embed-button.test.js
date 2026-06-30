/**
 * EmbedButton Component Tests
 *
 * Tests the main embed button functionality, styling, and interactions
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { EmbedButton } from '../../src/components/EmbedButton';

describe('EmbedButton Component', () => {
  const mockConfig = {
    productImage: 'test-image.jpg',
    sku: 'TEST-001',
    productName: 'Test Product',
    productPrice: 9999,
    category: 'Test Category',
    buttonText: 'Visualize in Your Room',
  };

  test('renders with default button text', () => {
    const mockOnClick = jest.fn();
    render(<EmbedButton config={mockConfig} onClick={mockOnClick} />);

    expect(screen.getByText('Visualize in Your Room')).toBeInTheDocument();
  });

  test('renders with custom button text', () => {
    const customConfig = { ...mockConfig, buttonText: 'Custom Text' };
    const mockOnClick = jest.fn();
    render(<EmbedButton config={customConfig} onClick={mockOnClick} />);

    expect(screen.getByText('Custom Text')).toBeInTheDocument();
  });

  test('calls onClick when clicked', () => {
    const mockOnClick = jest.fn();
    render(<EmbedButton config={mockConfig} onClick={mockOnClick} />);

    fireEvent.click(screen.getByRole('button'));
    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });

  test('applies custom styling', () => {
    const styledConfig = {
      ...mockConfig,
      styling: {
        buttonColor: '#ff0000',
        buttonTextColor: '#ffffff',
      },
    };
    const mockOnClick = jest.fn();
    render(<EmbedButton config={styledConfig} onClick={mockOnClick} />);

    const button = screen.getByRole('button');
    expect(button).toHaveStyle('background-color: #ff0000');
    expect(button).toHaveStyle('color: #ffffff');
  });

  test('handles missing config gracefully', () => {
    const mockOnClick = jest.fn();
    render(<EmbedButton config={{}} onClick={mockOnClick} />);

    // Should render with fallback text
    expect(screen.getByText('Visualize in Your Room')).toBeInTheDocument();
  });
});
