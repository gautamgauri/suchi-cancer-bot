import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MessageList, Message } from '../MessageList';

// Mock dependent components
vi.mock('../SuchiAvatar', () => ({
  SuchiAvatar: ({ size }: { size: string }) => (
    <div data-testid="suchi-avatar" data-size={size}>Avatar</div>
  ),
}));

vi.mock('../Citation', () => ({
  Citation: ({ citation, index }: { citation: { title: string }; index: number }) => (
    <span data-testid="citation">[{index + 1}] {citation.title}</span>
  ),
}));

vi.mock('../MessageActions', () => ({
  MessageActions: ({ onFeedback }: { onFeedback: (rating: 'up' | 'down') => void }) => (
    <div data-testid="message-actions">
      <button onClick={() => onFeedback('up')}>Like</button>
      <button onClick={() => onFeedback('down')}>Dislike</button>
    </div>
  ),
}));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <span>{children}</span>,
}));

describe('MessageList', () => {
  const mockMessages: Message[] = [
    {
      id: 'msg-1',
      role: 'user',
      text: 'What are breast cancer symptoms?',
      timestamp: new Date('2026-01-27T10:00:00.000Z'),
    },
    {
      id: 'msg-2',
      role: 'assistant',
      text: 'Breast cancer symptoms include lumps [citation:doc1:chunk1].',
      timestamp: new Date('2026-01-27T10:00:05.000Z'),
    },
  ];

  describe('rendering empty state', () => {
    it('shows empty state when no messages', () => {
      render(<MessageList messages={[]} />);
      expect(screen.getByText(/Start a conversation/)).toBeInTheDocument();
    });

    it('shows avatar in empty state', () => {
      render(<MessageList messages={[]} />);
      const avatar = screen.getByTestId('suchi-avatar');
      expect(avatar).toHaveAttribute('data-size', 'large');
    });

    it('shows help text in empty state', () => {
      render(<MessageList messages={[]} />);
      expect(screen.getByText(/cancer-related information/)).toBeInTheDocument();
    });
  });

  describe('rendering messages', () => {
    it('renders user messages', () => {
      render(<MessageList messages={[mockMessages[0]]} />);
      expect(screen.getByText('What are breast cancer symptoms?')).toBeInTheDocument();
    });

    it('renders assistant messages', () => {
      render(<MessageList messages={[mockMessages[1]]} />);
      expect(screen.getByText(/Breast cancer symptoms/)).toBeInTheDocument();
    });

    it('renders multiple messages', () => {
      render(<MessageList messages={mockMessages} />);
      expect(screen.getByText('What are breast cancer symptoms?')).toBeInTheDocument();
      expect(screen.getByText(/Breast cancer symptoms/)).toBeInTheDocument();
    });

    it('renders avatar for assistant messages', () => {
      render(<MessageList messages={[mockMessages[1]]} />);
      const avatar = screen.getByTestId('suchi-avatar');
      expect(avatar).toHaveAttribute('data-size', 'small');
    });

    it('does not render avatar for user messages', () => {
      render(<MessageList messages={[mockMessages[0]]} />);
      expect(screen.queryByTestId('suchi-avatar')).not.toBeInTheDocument();
    });
  });

  describe('citations', () => {
    it('renders citations in assistant messages', () => {
      render(<MessageList messages={[mockMessages[1]]} />);
      expect(screen.getByTestId('citation')).toBeInTheDocument();
    });

    it('renders sources section when citations present', () => {
      render(<MessageList messages={[mockMessages[1]]} />);
      expect(screen.getByText(/Sources \(1\)/)).toBeInTheDocument();
    });

    it('does not render citations for user messages', () => {
      const userMessageWithBrackets: Message = {
        id: 'msg-3',
        role: 'user',
        text: 'What about [specific] details?',
      };
      render(<MessageList messages={[userMessageWithBrackets]} />);
      expect(screen.queryByTestId('citation')).not.toBeInTheDocument();
    });
  });

  describe('timestamps', () => {
    it('renders timestamp when provided', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-27T12:00:00.000Z'));

      render(<MessageList messages={[mockMessages[0]]} />);
      expect(screen.getByText(/hours ago|hour ago/)).toBeInTheDocument();

      vi.useRealTimers();
    });

    it('does not render timestamp when not provided', () => {
      const messageNoTimestamp: Message = {
        id: 'msg-no-ts',
        role: 'user',
        text: 'Test message',
      };
      render(<MessageList messages={[messageNoTimestamp]} />);
      expect(screen.queryByText(/ago/)).not.toBeInTheDocument();
    });
  });

  describe('feedback', () => {
    it('renders message actions for assistant messages', () => {
      render(<MessageList messages={[mockMessages[1]]} />);
      expect(screen.getByTestId('message-actions')).toBeInTheDocument();
    });

    it('does not render message actions for user messages', () => {
      render(<MessageList messages={[mockMessages[0]]} />);
      expect(screen.queryByTestId('message-actions')).not.toBeInTheDocument();
    });

    it('calls onFeedback when feedback given', () => {
      const onFeedback = vi.fn();
      render(<MessageList messages={[mockMessages[1]]} onFeedback={onFeedback} />);

      const likeButton = screen.getByText('Like');
      likeButton.click();

      expect(onFeedback).toHaveBeenCalledWith('msg-2', 'up');
    });
  });

  describe('accessibility', () => {
    it('has role="log" for message container', () => {
      render(<MessageList messages={mockMessages} />);
      expect(screen.getByRole('log')).toBeInTheDocument();
    });

    it('has aria-live="polite" for live updates', () => {
      render(<MessageList messages={mockMessages} />);
      expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'polite');
    });

    it('has aria-label for message container', () => {
      render(<MessageList messages={mockMessages} />);
      expect(screen.getByRole('log')).toHaveAttribute('aria-label', 'Chat messages');
    });
  });
});
