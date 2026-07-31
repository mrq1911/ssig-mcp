import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/server/config.js';

describe('server configuration', () => {
  it('uses loopback by default', () => {
    expect(loadConfig({}).host).toBe('127.0.0.1');
  });

  it('requires an explicit private LAN address for non-loopback binding', () => {
    expect(() => loadConfig({ SSIG_HOST: '0.0.0.0' })).toThrow(/SSIG_ALLOW_LAN/);
    expect(() =>
      loadConfig({
        SSIG_HOST: '0.0.0.0',
        SSIG_ALLOW_LAN: 'true',
        SSIG_PUBLIC_HOST: '8.8.8.8',
      }),
    ).toThrow(/RFC1918/);

    const config = loadConfig({
      SSIG_HOST: '0.0.0.0',
      SSIG_ALLOW_LAN: 'true',
      SSIG_PUBLIC_HOST: '192.168.77.198',
    });
    expect(config.host).toBe('0.0.0.0');
    expect(config.publicHost).toBe('192.168.77.198');
  });
});
