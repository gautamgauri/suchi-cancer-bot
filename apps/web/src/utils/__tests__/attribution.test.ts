import { describe, it, expect } from 'vitest';
import { readAttribution } from '../attribution';

describe('readAttribution', () => {
  it('reads a valid src and utm_source', () => {
    expect(readAttribution('?src=site-article&utm_source=instagram')).toEqual({
      src: 'site-article',
      utm_source: 'instagram',
    });
  });

  it('returns nothing for a plain visit', () => {
    expect(readAttribution('')).toEqual({});
  });

  it.each([
    ['upper case', '?src=YT'],
    ['a URL', `?src=${encodeURIComponent('https://example.com/a')}`],
    ['free text', `?src=${encodeURIComponent('my aunt sent me')}`],
    ['too long', `?src=${'a'.repeat(33)}`],
    ['repeated', '?src=yt&src=qr'],
    ['empty', '?src='],
  ])('drops %s', (_label, search) => {
    expect(readAttribution(search)).toEqual({});
  });

  it('ignores other query parameters', () => {
    expect(readAttribution('?prompt=hello&src=yt&ref=https%3A%2F%2Fx')).toEqual({ src: 'yt' });
  });
});
