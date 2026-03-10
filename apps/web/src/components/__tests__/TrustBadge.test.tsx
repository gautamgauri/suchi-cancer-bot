import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TrustBadge } from '../TrustBadge';

describe('TrustBadge', () => {
  describe('trusted source detection', () => {
    it('renders badge when sourceType is NCI', () => {
      render(<TrustBadge sourceType="NCI" />);
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByText('Trusted Source')).toBeInTheDocument();
    });

    it('renders badge when sourceType is trusted', () => {
      render(<TrustBadge sourceType="trusted" />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('renders badge when source includes "National Cancer Institute"', () => {
      render(<TrustBadge source="National Cancer Institute - PDQ Cancer Information" />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('renders badge when source includes "NCI"', () => {
      render(<TrustBadge source="NCI Cancer Treatment Guidelines" />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('does not render when source is not trusted', () => {
      render(<TrustBadge sourceType="OTHER" source="Random Medical Website" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('does not render when no props provided', () => {
      render(<TrustBadge />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('does not render when sourceType is null', () => {
      render(<TrustBadge sourceType={null} source={null} />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('compact mode', () => {
    it('shows "Trusted Source" in default mode', () => {
      render(<TrustBadge sourceType="NCI" />);
      expect(screen.getByText('Trusted Source')).toBeInTheDocument();
    });

    it('shows "Trusted" in compact mode', () => {
      render(<TrustBadge sourceType="NCI" compact={true} />);
      expect(screen.getByText('Trusted')).toBeInTheDocument();
      expect(screen.queryByText('Trusted Source')).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has role="status" for screen readers', () => {
      render(<TrustBadge sourceType="NCI" />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('has aria-label for trust badge', () => {
      render(<TrustBadge sourceType="NCI" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Trusted source');
    });

    it('has aria-hidden on decorative checkmark icon', () => {
      render(<TrustBadge sourceType="NCI" />);
      expect(screen.getByText('✓')).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('multiple trust indicators', () => {
    it('renders when both sourceType and source indicate trusted', () => {
      render(<TrustBadge sourceType="NCI" source="National Cancer Institute" />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('renders when only sourceType indicates trusted', () => {
      render(<TrustBadge sourceType="NCI" source="Unknown Source" />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('renders when only source indicates trusted', () => {
      render(<TrustBadge sourceType="OTHER" source="National Cancer Institute PDQ" />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });
});
