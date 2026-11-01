// @sdk-implemented-by: F1-transport

import { describe, expect, it } from 'bun:test';
import {
  isSecretKey,
  looksLikeSecretValue,
  maskValue,
  redact,
  redactHeaders,
} from '@core/utils/redact';

describe('isSecretKey', () => {
  it('matches every credential header, case-insensitively', () => {
    for (const key of [
      'xp-key',
      'sp-key',
      'mp-key',
      'uix-pky',
      'XP-KEY',
      'Sp_Key',
      'uix_pky',
      'xPkEy',
      'Authorization',
      'cookie',
      'set-cookie',
    ]) {
      expect(isSecretKey(key)).toBe(true);
    }
  });

  it('does not match ordinary headers or fields', () => {
    for (const key of ['content-type', 'accept', 'reference', 'publicKey', 'x-request-id', '']) {
      expect(isSecretKey(key)).toBe(false);
    }
  });
});

describe('maskValue', () => {
  it('returns an empty string unchanged', () => {
    expect(maskValue('')).toBe('');
  });

  it('fully masks short values', () => {
    expect(maskValue('short')).toBe('***');
    expect(maskValue('twelve-chars')).toBe('***');
    expect(maskValue('123456789012')).toBe('***');
  });

  it('keeps the first and last four characters of long values', () => {
    expect(maskValue('1234567890123')).toBe('1234***0123');
    expect(maskValue('pk_live_1234567890')).toBe('pk_l***7890');
  });
});

describe('looksLikeSecretValue', () => {
  it('detects long opaque tokens', () => {
    expect(looksLikeSecretValue('abcdefghijklmnop')).toBe(true);
    expect(looksLikeSecretValue('sk_live_0123456789abcdef')).toBe(true);
    expect(looksLikeSecretValue('QUJDREVGR0hJSktMTU5PUA==')).toBe(true);
  });

  it('detects bearer tokens', () => {
    expect(looksLikeSecretValue('Bearer abc')).toBe(true);
    expect(looksLikeSecretValue('bearer sk_live_0123456789abcdef')).toBe(true);
  });

  it('leaves ordinary values alone', () => {
    expect(looksLikeSecretValue('short')).toBe(false);
    expect(looksLikeSecretValue('ref_1')).toBe(false);
    expect(looksLikeSecretValue('')).toBe(false);
    expect(looksLikeSecretValue('Payment already completed')).toBe(false);
  });
});

describe('redactHeaders', () => {
  it('masks credential-bearing headers and keeps the rest', () => {
    const headers = redactHeaders({
      'xp-key': 'pk_live_1234567890',
      'sp-key': 'sk_live_1234567890',
      authorization: 'Bearer abc',
      accept: 'application/json',
      'user-agent': 'myimopay-node/0.1.0',
      'content-type': 'application/json',
    });

    expect(headers).toEqual({
      'xp-key': 'pk_l***7890',
      'sp-key': 'sk_l***7890',
      authorization: '***',
      accept: 'application/json',
      'user-agent': 'myimopay-node/0.1.0',
      'content-type': 'application/json',
    });
  });

  it('does not mutate the input', () => {
    const headers = { 'xp-key': 'pk_live_1234567890' };
    redactHeaders(headers);
    expect(headers['xp-key']).toBe('pk_live_1234567890');
  });
});

describe('redact', () => {
  it('masks values under secret-looking keys and bare secret strings', () => {
    const input = {
      reference: 'ref_1',
      apiKey: 'sk_live_abcdefghijklmnop',
      nested: { ['sp_key']: 'secret-value', safe: 42 },
      list: ['short', 'abcdefghijklmnopqrst'],
    };

    const output = redact(input) as typeof input;

    expect(output.reference).toBe('ref_1');
    expect(output.apiKey).toBe('sk_l***mnop');
    expect(output.nested).toEqual({ ['sp_key']: '***', safe: 42 });
    expect(output.list[0]).toBe('short');
    expect(output.list[1]).toBe('abcd***qrst');
  });

  it('preserves null, numbers and booleans', () => {
    expect(redact(null)).toBeNull();
    expect(redact(42)).toBe(42);
    expect(redact(false)).toBe(false);
    expect(redact(undefined)).toBeUndefined();
  });

  it('preserves Date instances', () => {
    const date = new Date('2020-01-02T03:04:05.000Z');
    const output = redact({ createdAt: date }) as { createdAt: Date };

    expect(output.createdAt).toBeInstanceOf(Date);
    expect(output.createdAt.getTime()).toBe(date.getTime());
    expect(output.createdAt).not.toBe(date);
  });

  it('replaces cycles instead of recursing forever', () => {
    interface Cyclic {
      name: string;
      self?: unknown;
      list?: unknown[];
    }

    const cyclic: Cyclic = { name: 'loop' };
    cyclic.self = cyclic;
    cyclic.list = [cyclic];

    const output = redact(cyclic) as Cyclic;

    expect(output.name).toBe('loop');
    expect(output.self).toBe('[Circular]');
    expect(output.list).toEqual(['[Circular]']);
  });

  it('never mutates the input', () => {
    const input = { 'xp-key': 'pk_live_1234567890', nested: { token: 'abcdefghijklmnop' } };
    redact(input);

    expect(input['xp-key']).toBe('pk_live_1234567890');
    expect(input.nested.token).toBe('abcdefghijklmnop');
  });

  it('never throws', () => {
    const hostile = {
      get boom(): string {
        throw new Error('nope');
      },
    };

    expect(() => redact(hostile)).not.toThrow();
    expect(redact(hostile)).toBe('[Unserializable]');
  });
});
