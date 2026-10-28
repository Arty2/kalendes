import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// vercel.json's Content-Security-Policy allows index.html's inline theme script
// by its hash: edit the script and the hash must follow, or the browser blocks
// it (the page then flashes unthemed on load).
const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

function policy(): string {
  const config = JSON.parse(read('vercel.json')) as { headers: { headers: { key: string; value: string }[] }[] };
  const header = config.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy');
  if (!header) throw new Error('no Content-Security-Policy in vercel.json');
  return header.value;
}

describe('Content-Security-Policy', () => {
  it("allows each of index.html's inline scripts by hash, and nothing else inline", () => {
    const html = read('index.html');
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
      (m) => `'sha256-${createHash('sha256').update(m[1]!).digest('base64')}'`,
    );
    const scriptSrc = policy().split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src '))!;
    const hashes = scriptSrc.split(' ').filter((t) => t.startsWith("'sha256-"));
    expect(hashes.sort()).toEqual(inline.sort());
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it('forbids framing and plugins', () => {
    expect(policy()).toContain("frame-ancestors 'none'");
    expect(policy()).toContain("object-src 'none'");
  });
});
