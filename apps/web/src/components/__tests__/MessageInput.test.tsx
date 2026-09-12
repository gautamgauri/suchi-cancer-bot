import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MessageInput } from '../MessageInput';

describe('MessageInput', () => {
  describe('rendering', () => {
    it('renders textarea with default placeholder', () => {
      render(<MessageInput onSend={vi.fn()} />);
      expect(screen.getByPlaceholderText('Type your message...')).toBeInTheDocument();
    });

    it('renders textarea with custom placeholder', () => {
      render(<MessageInput onSend={vi.fn()} placeholder="Ask Suchi a question..." />);
      expect(screen.getByPlaceholderText('Ask Suchi a question...')).toBeInTheDocument();
    });

    it('renders send button', () => {
      render(<MessageInput onSend={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument();
    });

    it('has proper ARIA attributes on textarea', () => {
      render(<MessageInput onSend={vi.fn()} />);
      const textarea = screen.getByRole('textbox', { name: 'Message input' });
      expect(textarea).toHaveAttribute('aria-describedby', 'input-help');
    });
  });

  describe('sending messages', () => {
    it('calls onSend with trimmed text when send button clicked', () => {
      const onSend = vi.fn();
      render(<MessageInput onSend={onSend} />);

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: '  Hello Suchi  ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

      expect(onSend).toHaveBeenCalledWith('Hello Suchi');
    });

    it('clears textarea after sending', () => {
      const onSend = vi.fn();
      render(<MessageInput onSend={onSend} />);

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'Test message' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

      expect(textarea).toHaveValue('');
    });

    it('calls onSend when Enter key is pressed', () => {
      const onSend = vi.fn();
      render(<MessageInput onSend={onSend} />);

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'Test message' } });
      fireEvent.keyPress(textarea, { key: 'Enter', code: 'Enter', charCode: 13 });

      expect(onSend).toHaveBeenCalledWith('Test message');
    });

    it('does not send when Shift+Enter is pressed (allows newline)', () => {
      const onSend = vi.fn();
      render(<MessageInput onSend={onSend} />);

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'Test message' } });
      fireEvent.keyPress(textarea, { key: 'Enter', code: 'Enter', charCode: 13, shiftKey: true });

      expect(onSend).not.toHaveBeenCalled();
    });
  });

  describe('empty and whitespace handling', () => {
    it('does not send empty message', () => {
      const onSend = vi.fn();
      render(<MessageInput onSend={onSend} />);

      fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

      expect(onSend).not.toHaveBeenCalled();
    });

    it('does not send whitespace-only message', () => {
      const onSend = vi.fn();
      render(<MessageInput onSend={onSend} />);

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: '   ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

      expect(onSend).not.toHaveBeenCalled();
    });

    it('disables send button when text is empty', () => {
      render(<MessageInput onSend={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    });

    it('disables send button when text is whitespace only', () => {
      render(<MessageInput onSend={vi.fn()} />);

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: '   ' } });

      expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    });

    it('enables send button when text has content', () => {
      render(<MessageInput onSend={vi.fn()} />);

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'Hello' } });

      expect(screen.getByRole('button', { name: 'Send message' })).not.toBeDisabled();
    });
  });

  describe('disabled state', () => {
    it('disables textarea when disabled prop is true', () => {
      render(<MessageInput onSend={vi.fn()} disabled={true} />);
      expect(screen.getByRole('textbox')).toBeDisabled();
    });

    it('disables send button when disabled prop is true', () => {
      render(<MessageInput onSend={vi.fn()} disabled={true} />);
      expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    });

    it('does not call onSend when disabled even with text', () => {
      const onSend = vi.fn();
      render(<MessageInput onSend={onSend} disabled={true} />);

      // Note: Can't change value when disabled, but test the button click anyway
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

      expect(onSend).not.toHaveBeenCalled();
    });
  });

  // Issue #115: the API applies speech-stutter cleanup only to spoken input, so
  // the component must say when the browser mic contributed to a message.
  describe('input modality flag', () => {
    class FakeRecognition {
      static last: FakeRecognition | null = null;
      continuous = false;
      interimResults = false;
      lang = '';
      onresult: ((e: any) => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      stop = vi.fn();
      constructor() { FakeRecognition.last = this; }
    }

    const install = () => {
      (window as any).SpeechRecognition = FakeRecognition;
      FakeRecognition.last = null;
    };
    const uninstall = () => {
      delete (window as any).SpeechRecognition;
    };

    it('typed text is sent without a modality flag (backward compatible)', () => {
      const onSend = vi.fn();
      render(<MessageInput onSend={onSend} />);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'meri didi ko dard hai' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
      expect(onSend).toHaveBeenCalledTimes(1);
      expect(onSend.mock.calls[0]).toEqual(['meri didi ko dard hai']);
    });

    it('text dictated through the mic is sent with inputMode "voice"', () => {
      install();
      try {
        const onSend = vi.fn();
        render(<MessageInput onSend={onSend} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start voice input' }));
        const rec = FakeRecognition.last!;
        expect(rec.start).toHaveBeenCalled();
        act(() => rec.onresult!({ results: [Object.assign([{ transcript: 'telltell me about chemo' }], { isFinal: true })] }));
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        expect(onSend).toHaveBeenCalledWith('telltell me about chemo', { inputMode: 'voice' });
      } finally {
        uninstall();
      }
    });

    it('the flag resets after sending: the next typed message carries none', () => {
      install();
      try {
        const onSend = vi.fn();
        render(<MessageInput onSend={onSend} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start voice input' }));
        act(() => FakeRecognition.last!.onresult!({ results: [Object.assign([{ transcript: 'first' }], { isFinal: true })] }));
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'second, typed' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        expect(onSend.mock.calls[1]).toEqual(['second, typed']);
      } finally {
        uninstall();
      }
    });
  });
});
