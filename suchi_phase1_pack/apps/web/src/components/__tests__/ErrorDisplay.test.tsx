import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ErrorDisplay } from '../ErrorDisplay';

describe('ErrorDisplay', () => {
  describe('rendering', () => {
    it('renders with default error message', () => {
      render(<ErrorDisplay />);
      expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument();
    });

    it('renders with custom error message', () => {
      render(<ErrorDisplay message="Connection failed. Please check your internet." />);
      expect(screen.getByText('Connection failed. Please check your internet.')).toBeInTheDocument();
    });

    it('renders help text', () => {
      render(<ErrorDisplay />);
      expect(screen.getByText(/If this problem persists/)).toBeInTheDocument();
    });

    it('renders warning icon', () => {
      render(<ErrorDisplay />);
      expect(screen.getByText('⚠️')).toBeInTheDocument();
    });
  });

  describe('retry button', () => {
    it('does not render retry button when onRetry is not provided', () => {
      render(<ErrorDisplay />);
      expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
    });

    it('renders retry button when onRetry is provided', () => {
      render(<ErrorDisplay onRetry={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    });

    it('calls onRetry when retry button is clicked', () => {
      const onRetry = vi.fn();
      render(<ErrorDisplay onRetry={onRetry} />);

      fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe('dismiss button', () => {
    it('does not render dismiss button when onDismiss is not provided', () => {
      render(<ErrorDisplay />);
      expect(screen.queryByRole('button', { name: 'Dismiss error' })).not.toBeInTheDocument();
    });

    it('renders dismiss button when onDismiss is provided', () => {
      render(<ErrorDisplay onDismiss={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Dismiss error' })).toBeInTheDocument();
    });

    it('calls onDismiss when dismiss button is clicked', () => {
      const onDismiss = vi.fn();
      render(<ErrorDisplay onDismiss={onDismiss} />);

      fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe('with both callbacks', () => {
    it('renders both retry and dismiss buttons', () => {
      render(<ErrorDisplay onRetry={vi.fn()} onDismiss={vi.fn()} />);

      expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Dismiss error' })).toBeInTheDocument();
    });

    it('handles both callbacks independently', () => {
      const onRetry = vi.fn();
      const onDismiss = vi.fn();
      render(<ErrorDisplay onRetry={onRetry} onDismiss={onDismiss} />);

      fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onDismiss).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe('accessibility', () => {
    it('has role="alert" for error announcements', () => {
      render(<ErrorDisplay />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('has aria-live="assertive" for urgent error messages', () => {
      render(<ErrorDisplay />);
      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('aria-live', 'assertive');
    });

    it('has aria-hidden on decorative icon', () => {
      render(<ErrorDisplay />);
      const icon = screen.getByText('⚠️');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    });

    it('dismiss button has accessible label', () => {
      render(<ErrorDisplay onDismiss={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Dismiss error' })).toBeInTheDocument();
    });
  });
});
