import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LoadingIndicator } from '../LoadingIndicator';

// Mock SuchiAvatar component
vi.mock('../SuchiAvatar', () => ({
  SuchiAvatar: ({ size, animated }: { size: string; animated: boolean }) => (
    <div data-testid="suchi-avatar" data-size={size} data-animated={animated}>
      Avatar
    </div>
  ),
}));

describe('LoadingIndicator', () => {
  describe('rendering', () => {
    it('renders with default message', () => {
      render(<LoadingIndicator />);
      expect(screen.getByText('Suchi is thinking...')).toBeInTheDocument();
    });

    it('renders with custom message', () => {
      render(<LoadingIndicator message="Processing your question..." />);
      expect(screen.getByText('Processing your question...')).toBeInTheDocument();
    });

    it('renders SuchiAvatar with correct props', () => {
      render(<LoadingIndicator />);
      const avatar = screen.getByTestId('suchi-avatar');
      expect(avatar).toHaveAttribute('data-size', 'small');
      expect(avatar).toHaveAttribute('data-animated', 'true');
    });

    it('renders animated dots', () => {
      render(<LoadingIndicator />);
      const dots = screen.getAllByText('.');
      expect(dots).toHaveLength(3);
    });
  });

  describe('accessibility', () => {
    it('has role="status" for screen readers', () => {
      render(<LoadingIndicator />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('has aria-live="polite" for non-urgent updates', () => {
      render(<LoadingIndicator />);
      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-live', 'polite');
    });

    it('has aria-label for loading state', () => {
      render(<LoadingIndicator />);
      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-label', 'Loading');
    });
  });
});
