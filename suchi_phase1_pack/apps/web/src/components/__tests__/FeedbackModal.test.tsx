import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FeedbackModal } from '../FeedbackModal';

describe('FeedbackModal', () => {
  const defaultProps = {
    messageId: 'msg-123',
    onClose: vi.fn(),
    onSubmit: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders modal with title', () => {
      render(<FeedbackModal {...defaultProps} />);
      expect(screen.getByText('Feedback')).toBeInTheDocument();
    });

    it('renders rating question', () => {
      render(<FeedbackModal {...defaultProps} />);
      expect(screen.getByText('Was this response helpful?')).toBeInTheDocument();
    });

    it('renders Yes and No rating buttons', () => {
      render(<FeedbackModal {...defaultProps} />);
      expect(screen.getByText('👍 Yes')).toBeInTheDocument();
      expect(screen.getByText('👎 No')).toBeInTheDocument();
    });

    it('renders close button', () => {
      render(<FeedbackModal {...defaultProps} />);
      expect(screen.getByText('×')).toBeInTheDocument();
    });

    it('renders Cancel and Submit buttons', () => {
      render(<FeedbackModal {...defaultProps} />);
      expect(screen.getByText('Cancel')).toBeInTheDocument();
      expect(screen.getByText('Submit')).toBeInTheDocument();
    });

    it('renders comment textarea', () => {
      render(<FeedbackModal {...defaultProps} />);
      expect(screen.getByPlaceholderText('Share your feedback...')).toBeInTheDocument();
    });
  });

  describe('rating selection', () => {
    it('selects positive rating when Yes clicked', () => {
      render(<FeedbackModal {...defaultProps} />);
      fireEvent.click(screen.getByText('👍 Yes'));

      // Submit should now be enabled
      const submitButton = screen.getByText('Submit');
      expect(submitButton).not.toBeDisabled();
    });

    it('selects negative rating when No clicked', () => {
      render(<FeedbackModal {...defaultProps} />);
      fireEvent.click(screen.getByText('👎 No'));

      const submitButton = screen.getByText('Submit');
      expect(submitButton).not.toBeDisabled();
    });

    it('shows reason dropdown when negative rating selected', () => {
      render(<FeedbackModal {...defaultProps} />);
      fireEvent.click(screen.getByText('👎 No'));

      expect(screen.getByText('Reason (optional)')).toBeInTheDocument();
      expect(screen.getByText('Select a reason')).toBeInTheDocument();
    });

    it('does not show reason dropdown when positive rating selected', () => {
      render(<FeedbackModal {...defaultProps} />);
      fireEvent.click(screen.getByText('👍 Yes'));

      expect(screen.queryByText('Reason (optional)')).not.toBeInTheDocument();
    });

    it('shows reason options in dropdown', () => {
      render(<FeedbackModal {...defaultProps} />);
      fireEvent.click(screen.getByText('👎 No'));

      expect(screen.getByText('Incorrect information')).toBeInTheDocument();
      expect(screen.getByText('Not helpful')).toBeInTheDocument();
      expect(screen.getByText('Incomplete answer')).toBeInTheDocument();
      expect(screen.getByText('Other')).toBeInTheDocument();
    });
  });

  describe('form submission', () => {
    it('submit button is disabled when no rating selected', () => {
      render(<FeedbackModal {...defaultProps} />);
      expect(screen.getByText('Submit')).toBeDisabled();
    });

    it('submits positive feedback correctly', () => {
      const onSubmit = vi.fn();
      render(<FeedbackModal {...defaultProps} onSubmit={onSubmit} />);

      fireEvent.click(screen.getByText('👍 Yes'));
      fireEvent.click(screen.getByText('Submit'));

      expect(onSubmit).toHaveBeenCalledWith('up', undefined, undefined);
    });

    it('submits negative feedback with reason', () => {
      const onSubmit = vi.fn();
      render(<FeedbackModal {...defaultProps} onSubmit={onSubmit} />);

      fireEvent.click(screen.getByText('👎 No'));
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'incorrect' } });
      fireEvent.click(screen.getByText('Submit'));

      expect(onSubmit).toHaveBeenCalledWith('down', 'incorrect', undefined);
    });

    it('submits feedback with comment', () => {
      const onSubmit = vi.fn();
      render(<FeedbackModal {...defaultProps} onSubmit={onSubmit} />);

      fireEvent.click(screen.getByText('👍 Yes'));
      fireEvent.change(screen.getByPlaceholderText('Share your feedback...'), {
        target: { value: 'Great response!' },
      });
      fireEvent.click(screen.getByText('Submit'));

      expect(onSubmit).toHaveBeenCalledWith('up', undefined, 'Great response!');
    });

    it('calls onClose after successful submission', () => {
      const onClose = vi.fn();
      render(<FeedbackModal {...defaultProps} onClose={onClose} />);

      fireEvent.click(screen.getByText('👍 Yes'));
      fireEvent.click(screen.getByText('Submit'));

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('closing modal', () => {
    it('calls onClose when close button clicked', () => {
      const onClose = vi.fn();
      render(<FeedbackModal {...defaultProps} onClose={onClose} />);

      fireEvent.click(screen.getByText('×'));

      expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose when Cancel clicked', () => {
      const onClose = vi.fn();
      render(<FeedbackModal {...defaultProps} onClose={onClose} />);

      fireEvent.click(screen.getByText('Cancel'));

      expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose when overlay clicked', () => {
      const onClose = vi.fn();
      const { container } = render(<FeedbackModal {...defaultProps} onClose={onClose} />);

      // Click overlay (first div)
      const overlay = container.firstChild as HTMLElement;
      fireEvent.click(overlay);

      expect(onClose).toHaveBeenCalled();
    });

    it('does not close when modal content clicked', () => {
      const onClose = vi.fn();
      render(<FeedbackModal {...defaultProps} onClose={onClose} />);

      fireEvent.click(screen.getByText('Feedback'));

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('comment input', () => {
    it('allows entering comment text', () => {
      render(<FeedbackModal {...defaultProps} />);

      const textarea = screen.getByPlaceholderText('Share your feedback...');
      fireEvent.change(textarea, { target: { value: 'This is my comment' } });

      expect(textarea).toHaveValue('This is my comment');
    });

    it('comment label shows optional', () => {
      render(<FeedbackModal {...defaultProps} />);
      expect(screen.getByText('Additional comments (optional)')).toBeInTheDocument();
    });
  });
});
