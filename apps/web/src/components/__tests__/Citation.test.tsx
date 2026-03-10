import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Citation, CitationData } from '../Citation';

describe('Citation', () => {
  const baseCitation: CitationData = {
    docId: 'test-doc-id',
    chunkId: 'test-chunk-id',
    title: 'Test Source Title',
    source: 'Test Source',
  };

  describe('rendering', () => {
    it('renders citation number correctly', () => {
      render(<Citation citation={baseCitation} index={0} />);
      expect(screen.getByText('[1]')).toBeInTheDocument();
    });

    it('renders correct index for any position', () => {
      render(<Citation citation={baseCitation} index={4} />);
      expect(screen.getByText('[5]')).toBeInTheDocument();
    });

    it('has correct aria-label with citation number and title', () => {
      render(<Citation citation={baseCitation} index={0} />);
      expect(screen.getByRole('button')).toHaveAttribute(
        'aria-label',
        'Citation 1: Test Source Title'
      );
    });

    it('uses "Source" as default title when no title provided', () => {
      const citationNoTitle: CitationData = {
        docId: 'test-doc',
        chunkId: 'test-chunk',
      };
      render(<Citation citation={citationNoTitle} index={0} />);
      expect(screen.getByRole('button')).toHaveAttribute(
        'aria-label',
        'Citation 1: Source'
      );
    });
  });

  describe('tooltip behavior', () => {
    it('does not show tooltip by default', () => {
      render(<Citation citation={baseCitation} index={0} />);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('shows tooltip on mouse enter', () => {
      render(<Citation citation={baseCitation} index={0} />);
      const citation = screen.getByRole('button');

      fireEvent.mouseEnter(citation);

      expect(screen.getByRole('tooltip')).toBeInTheDocument();
      expect(screen.getByText('Test Source Title')).toBeInTheDocument();
    });

    it('hides tooltip on mouse leave', () => {
      render(<Citation citation={baseCitation} index={0} />);
      const citation = screen.getByRole('button');

      fireEvent.mouseEnter(citation);
      expect(screen.getByRole('tooltip')).toBeInTheDocument();

      fireEvent.mouseLeave(citation);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('displays source in tooltip when provided', () => {
      render(<Citation citation={baseCitation} index={0} />);
      const citation = screen.getByRole('button');

      fireEvent.mouseEnter(citation);

      expect(screen.getByText('Test Source')).toBeInTheDocument();
    });

    it('displays "View source" link when URL is provided', () => {
      const citationWithUrl: CitationData = {
        ...baseCitation,
        url: 'https://example.com/source',
      };
      render(<Citation citation={citationWithUrl} index={0} />);
      const citation = screen.getByRole('button');

      fireEvent.mouseEnter(citation);

      const link = screen.getByText('View source →');
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', 'https://example.com/source');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  describe('trust badge', () => {
    it('shows trusted badge when isTrusted is true', () => {
      const trustedCitation: CitationData = {
        ...baseCitation,
        isTrusted: true,
      };
      render(<Citation citation={trustedCitation} index={0} />);
      const citation = screen.getByRole('button');

      fireEvent.mouseEnter(citation);

      expect(screen.getByText('✓ Trusted')).toBeInTheDocument();
    });

    it('shows trusted badge when sourceType is NCI', () => {
      const nciCitation: CitationData = {
        ...baseCitation,
        sourceType: 'NCI',
      };
      render(<Citation citation={nciCitation} index={0} />);
      const citation = screen.getByRole('button');

      fireEvent.mouseEnter(citation);

      expect(screen.getByText('✓ Trusted')).toBeInTheDocument();
    });

    it('shows trusted badge when source includes National Cancer Institute', () => {
      const nciSourceCitation: CitationData = {
        ...baseCitation,
        source: 'National Cancer Institute - PDQ',
      };
      render(<Citation citation={nciSourceCitation} index={0} />);
      const citation = screen.getByRole('button');

      fireEvent.mouseEnter(citation);

      expect(screen.getByText('✓ Trusted')).toBeInTheDocument();
    });

    it('does not show trusted badge for non-trusted sources', () => {
      const untrustedCitation: CitationData = {
        ...baseCitation,
        isTrusted: false,
        sourceType: 'OTHER',
        source: 'Random Website',
      };
      render(<Citation citation={untrustedCitation} index={0} />);
      const citation = screen.getByRole('button');

      fireEvent.mouseEnter(citation);

      expect(screen.queryByText('✓ Trusted')).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('is keyboard accessible with tabIndex', () => {
      render(<Citation citation={baseCitation} index={0} />);
      const citation = screen.getByRole('button');
      expect(citation).toHaveAttribute('tabIndex', '0');
    });

    it('has proper ARIA attributes', () => {
      render(<Citation citation={baseCitation} index={0} />);
      const citation = screen.getByRole('button');
      expect(citation).toHaveAttribute('aria-label');
    });
  });
});
