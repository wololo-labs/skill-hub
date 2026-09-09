import { isLoopbackUrl } from './guestGuard';

describe('isLoopbackUrl', () => {
  it('accepts the addresses that only this machine can reach', () => {
    for (const url of [
      'http://localhost:7007',
      'http://127.0.0.1:7007',
      'http://[::1]:7007',
      'https://localhost:7007/skill-hub',
    ]) {
      expect(isLoopbackUrl(url)).toBe(true);
    }
  });

  it('rejects anything another machine could reach, and anything unparseable', () => {
    for (const url of [
      'https://skill-hub.example.com',
      'http://10.0.0.4:7007',
      'http://192.168.1.20:7007',
      // Not loopback: the name merely starts with it.
      'http://localhost.example.com',
      'not a url',
      undefined,
    ]) {
      expect(isLoopbackUrl(url)).toBe(false);
    }
  });
});
