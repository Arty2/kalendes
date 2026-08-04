import { describe, it, expect } from 'vitest';
import { safeFetch, isPrivateHost, UnsafeRedirectError } from './ics';

// A fake fetch driven by a scripted list of responses (one per hop). Each entry
// is either a redirect (status + location) or a terminal body. Records the URLs
// it was asked to fetch so we can assert the loop stopped where expected.
function scriptedFetch(
  steps: Array<{ status: number; location?: string; body?: string }>,
) {
  const calls: string[] = [];
  let i = 0;
  const impl = async (url: string): Promise<Response> => {
    calls.push(url);
    const step = steps[i++] ?? { status: 200, body: 'END:VCALENDAR' };
    const headers = new Headers();
    if (step.location) headers.set('location', step.location);
    return new Response(step.body ?? null, { status: step.status, headers });
  };
  return { impl, calls };
}

// Treat these hostnames as private for the test, without touching real DNS.
const fakeIsPrivate = async (hostname: string): Promise<boolean> =>
  hostname === '169.254.169.254' || hostname === '127.0.0.1' || hostname === 'internal.local';

const ac = () => new AbortController().signal;

describe('safeFetch redirect validation', () => {
  it('returns the response for a non-redirect (0 hops)', async () => {
    const { impl, calls } = scriptedFetch([{ status: 200, body: 'BEGIN:VCALENDAR' }]);
    const res = await safeFetch('https://feed.example.com/cal.ics', { Accept: '*/*' }, ac(), {
      fetchImpl: impl,
      isPrivate: fakeIsPrivate,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('BEGIN:VCALENDAR');
    expect(calls).toEqual(['https://feed.example.com/cal.ics']);
  });

  it('follows a redirect to another public https host', async () => {
    const { impl, calls } = scriptedFetch([
      { status: 302, location: 'https://cdn.example.net/real.ics' },
      { status: 200, body: 'BEGIN:VCALENDAR' },
    ]);
    const res = await safeFetch('https://feed.example.com/cal.ics', { Accept: '*/*' }, ac(), {
      fetchImpl: impl,
      isPrivate: fakeIsPrivate,
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual([
      'https://feed.example.com/cal.ics',
      'https://cdn.example.net/real.ics',
    ]);
  });

  it('rejects a redirect to a private/link-local host (cloud metadata SSRF)', async () => {
    const { impl } = scriptedFetch([
      { status: 302, location: 'http://169.254.169.254/latest/meta-data/' },
    ]);
    await expect(
      safeFetch('https://feed.example.com/cal.ics', { Accept: '*/*' }, ac(), {
        fetchImpl: impl,
        isPrivate: fakeIsPrivate,
      }),
    ).rejects.toBeInstanceOf(UnsafeRedirectError);
  });

  it('rejects a redirect that downgrades to http, even to a public host', async () => {
    const { impl } = scriptedFetch([
      { status: 302, location: 'http://feed.example.com/cal.ics' },
    ]);
    await expect(
      safeFetch('https://feed.example.com/cal.ics', { Accept: '*/*' }, ac(), {
        fetchImpl: impl,
        isPrivate: fakeIsPrivate,
      }),
    ).rejects.toBeInstanceOf(UnsafeRedirectError);
  });

  it('rejects a redirect to a private https host', async () => {
    const { impl } = scriptedFetch([{ status: 301, location: 'https://127.0.0.1/cal.ics' }]);
    await expect(
      safeFetch('https://feed.example.com/cal.ics', { Accept: '*/*' }, ac(), {
        fetchImpl: impl,
        isPrivate: fakeIsPrivate,
      }),
    ).rejects.toBeInstanceOf(UnsafeRedirectError);
  });

  it('rejects a chain longer than the hop cap', async () => {
    // Seven redirects, each to a fresh public host — exceeds MAX_REDIRECTS (5).
    const steps = Array.from({ length: 7 }, (_, i) => ({
      status: 302,
      location: `https://hop${i + 1}.example.com/cal.ics`,
    }));
    const { impl } = scriptedFetch(steps);
    await expect(
      safeFetch('https://feed.example.com/cal.ics', { Accept: '*/*' }, ac(), {
        fetchImpl: impl,
        isPrivate: fakeIsPrivate,
      }),
    ).rejects.toBeInstanceOf(UnsafeRedirectError);
  });

  it('drops conditional headers when following a redirect', async () => {
    const seen: Array<Record<string, string>> = [];
    const impl = async (_url: string, init: RequestInit): Promise<Response> => {
      seen.push({ ...(init.headers as Record<string, string>) });
      if (seen.length === 1) {
        return new Response(null, { status: 302, headers: new Headers({ location: 'https://cdn.example.net/x.ics' }) });
      }
      return new Response('BEGIN:VCALENDAR', { status: 200 });
    };
    await safeFetch(
      'https://feed.example.com/cal.ics',
      { Accept: 'text/calendar', 'If-None-Match': '"abc"' },
      ac(),
      { fetchImpl: impl, isPrivate: fakeIsPrivate },
    );
    expect(seen[0]!['If-None-Match']).toBe('"abc"');
    expect(seen[1]!['If-None-Match']).toBeUndefined();
  });
});

describe('isPrivateHost (literal IPs, no DNS)', () => {
  it('flags loopback, link-local, and private ranges', async () => {
    expect(await isPrivateHost('127.0.0.1')).toBe(true);
    expect(await isPrivateHost('169.254.169.254')).toBe(true);
    expect(await isPrivateHost('10.1.2.3')).toBe(true);
    expect(await isPrivateHost('192.168.0.1')).toBe(true);
    expect(await isPrivateHost('::1')).toBe(true);
  });
});
