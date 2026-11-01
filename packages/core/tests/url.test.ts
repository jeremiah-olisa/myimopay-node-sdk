// @sdk-implemented-by: F1-transport

import { describe, expect, it } from 'bun:test';
import { MyImoPayValidationError } from '@core/errors';
import { buildQuery, joinUrl } from '@core/utils/url';

describe('joinUrl', () => {
  it('joins a base and a path with exactly one slash', () => {
    expect(joinUrl('https://api.myimopay.test', '/vi/pay/initiate')).toBe(
      'https://api.myimopay.test/vi/pay/initiate',
    );
    expect(joinUrl('https://api.myimopay.test/', '/vi/pay/initiate')).toBe(
      'https://api.myimopay.test/vi/pay/initiate',
    );
    expect(joinUrl('https://api.myimopay.test///', '/vi/pay/initiate')).toBe(
      'https://api.myimopay.test/vi/pay/initiate',
    );
  });

  it('adds a leading slash to a path that lacks one', () => {
    expect(joinUrl('https://api.myimopay.test', 'vi/pay/initiate')).toBe(
      'https://api.myimopay.test/vi/pay/initiate',
    );
    expect(joinUrl('https://api.myimopay.test/', 'vi/pay/initiate')).toBe(
      'https://api.myimopay.test/vi/pay/initiate',
    );
  });

  it('never touches the protocol separator', () => {
    const joined = joinUrl('https://api.myimopay.test/', '/health');
    expect(joined.startsWith('https://')).toBe(true);
    expect(joined).toBe('https://api.myimopay.test/health');
  });

  it('keeps a trailing slash that comes from the path itself', () => {
    expect(joinUrl('https://api.myimopay.test', '/')).toBe('https://api.myimopay.test/');
  });

  it('rejects an empty base or an empty path', () => {
    expect(() => joinUrl('', '/health')).toThrow(MyImoPayValidationError);
    expect(() => joinUrl('   ', '/health')).toThrow(MyImoPayValidationError);
    expect(() => joinUrl('https://api.myimopay.test', '')).toThrow(MyImoPayValidationError);
  });

  it('rejects non-string input', () => {
    expect(() => joinUrl(42 as unknown as string, '/health')).toThrow(MyImoPayValidationError);
    expect(() => joinUrl('https://api.myimopay.test', null as unknown as string)).toThrow(
      MyImoPayValidationError,
    );
  });
});

describe('buildQuery', () => {
  it('returns an empty string for an empty object', () => {
    expect(buildQuery({})).toBe('');
  });

  it('drops undefined values and serialises numbers and booleans', () => {
    expect(buildQuery({ page: 2, live: true, archived: false, skip: undefined })).toBe(
      'page=2&live=true&archived=false',
    );
  });

  it('encodes keys and values', () => {
    expect(buildQuery({ 'a b': 'x&y', 'q/r': 'a b' })).toBe('a%20b=x%26y&q%2Fr=a%20b');
  });

  it('keeps insertion order and returns no leading question mark', () => {
    const query = buildQuery({ fromDate: '2024-01-01', toDate: '2024-02-01' });
    expect(query).toBe('fromDate=2024-01-01&toDate=2024-02-01');
    expect(query.startsWith('?')).toBe(false);
  });
});
