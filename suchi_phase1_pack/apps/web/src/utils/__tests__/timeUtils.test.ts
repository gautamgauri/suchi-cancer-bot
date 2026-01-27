import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatRelativeTime } from '../timeUtils';

describe('formatRelativeTime', () => {
  beforeEach(() => {
    // Mock Date to a fixed time: 2026-01-27 12:00:00
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-27T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('just now (< 60 seconds)', () => {
    it('returns "just now" for current time', () => {
      const date = new Date('2026-01-27T12:00:00.000Z');
      expect(formatRelativeTime(date)).toBe('just now');
    });

    it('returns "just now" for 30 seconds ago', () => {
      const date = new Date('2026-01-27T11:59:30.000Z');
      expect(formatRelativeTime(date)).toBe('just now');
    });

    it('returns "just now" for 59 seconds ago', () => {
      const date = new Date('2026-01-27T11:59:01.000Z');
      expect(formatRelativeTime(date)).toBe('just now');
    });
  });

  describe('minutes (1-59 minutes)', () => {
    it('returns "1 minute ago" for exactly 1 minute', () => {
      const date = new Date('2026-01-27T11:59:00.000Z');
      expect(formatRelativeTime(date)).toBe('1 minute ago');
    });

    it('returns "2 minutes ago" for 2 minutes', () => {
      const date = new Date('2026-01-27T11:58:00.000Z');
      expect(formatRelativeTime(date)).toBe('2 minutes ago');
    });

    it('returns "59 minutes ago" for 59 minutes', () => {
      const date = new Date('2026-01-27T11:01:00.000Z');
      expect(formatRelativeTime(date)).toBe('59 minutes ago');
    });
  });

  describe('hours (1-23 hours)', () => {
    it('returns "1 hour ago" for exactly 1 hour', () => {
      const date = new Date('2026-01-27T11:00:00.000Z');
      expect(formatRelativeTime(date)).toBe('1 hour ago');
    });

    it('returns "2 hours ago" for 2 hours', () => {
      const date = new Date('2026-01-27T10:00:00.000Z');
      expect(formatRelativeTime(date)).toBe('2 hours ago');
    });

    it('returns "23 hours ago" for 23 hours', () => {
      const date = new Date('2026-01-26T13:00:00.000Z');
      expect(formatRelativeTime(date)).toBe('23 hours ago');
    });
  });

  describe('days (1-6 days)', () => {
    it('returns "1 day ago" for exactly 1 day', () => {
      const date = new Date('2026-01-26T12:00:00.000Z');
      expect(formatRelativeTime(date)).toBe('1 day ago');
    });

    it('returns "2 days ago" for 2 days', () => {
      const date = new Date('2026-01-25T12:00:00.000Z');
      expect(formatRelativeTime(date)).toBe('2 days ago');
    });

    it('returns "6 days ago" for 6 days', () => {
      const date = new Date('2026-01-21T12:00:00.000Z');
      expect(formatRelativeTime(date)).toBe('6 days ago');
    });
  });

  describe('older dates (7+ days)', () => {
    it('returns formatted date for 7 days ago (same year)', () => {
      const date = new Date('2026-01-20T12:00:00.000Z');
      const result = formatRelativeTime(date);
      // Should be like "Jan 20" without year for same year
      expect(result).toMatch(/Jan 20/);
      expect(result).not.toMatch(/2026/);
    });

    it('returns formatted date with year for previous year', () => {
      const date = new Date('2025-12-15T12:00:00.000Z');
      const result = formatRelativeTime(date);
      // Should include year for different year
      expect(result).toMatch(/Dec 15/);
      expect(result).toMatch(/2025/);
    });
  });

  describe('edge cases', () => {
    it('handles exactly 60 seconds (1 minute boundary)', () => {
      const date = new Date('2026-01-27T11:59:00.000Z');
      expect(formatRelativeTime(date)).toBe('1 minute ago');
    });

    it('handles exactly 60 minutes (1 hour boundary)', () => {
      const date = new Date('2026-01-27T11:00:00.000Z');
      expect(formatRelativeTime(date)).toBe('1 hour ago');
    });

    it('handles exactly 24 hours (1 day boundary)', () => {
      const date = new Date('2026-01-26T12:00:00.000Z');
      expect(formatRelativeTime(date)).toBe('1 day ago');
    });
  });
});
