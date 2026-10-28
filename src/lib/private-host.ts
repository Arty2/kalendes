// Whether a feed URL's host is on the device's own network. Direct reads must
// not reach what the proxy refuses — a shared link would otherwise have the
// recipient's browser poke devices on their network on every refresh.
//
// The address ranges mirror api/ics.ts (`isPrivateLiteral`: PRIVATE_V4 and
// `isPrivateIPv6`, IPv4 inside IPv6 included); api/ics.test.ts checks the two
// agree. On top of those, names only a local resolver knows (`localhost`,
// `.local`, single-label intranet names) are refused here: the proxy would
// fail to resolve them anyway, but the browser can.
//
// This judges the configured host before any request. Redirects
// (feed-transport.ts): Auto reads with `redirect: 'manual'` and hands one to
// the proxy, which checks every hop; Direct follows it — the request to the
// target is made before the page can see it — and refuses an answer that
// landed on a private host. A public name that resolves to a private address
// is beyond what a page can see; Chrome's Private Network Access is the
// browser's own guard for that.

const PRIVATE_V4: ReadonlyArray<readonly [number, number]> = [
  [v4('10.0.0.0'), 8],
  [v4('172.16.0.0'), 12],
  [v4('192.168.0.0'), 16],
  [v4('127.0.0.0'), 8],
  [v4('169.254.0.0'), 16],
  [v4('0.0.0.0'), 8],
  [v4('100.64.0.0'), 10],
  [v4('192.0.0.0'), 24],
  [v4('192.0.2.0'), 24],
  [v4('198.18.0.0'), 15],
  [v4('198.51.100.0'), 24],
  [v4('203.0.113.0'), 24],
  [v4('224.0.0.0'), 4],
  [v4('240.0.0.0'), 4],
];

function v4(ip: string): number {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

function isPrivateV4Int(ip: number): boolean {
  return PRIVATE_V4.some(([base, bits]) => {
    const mask = (~0 << (32 - bits)) >>> 0;
    return ((ip & mask) >>> 0) === ((base & mask) >>> 0);
  });
}

// The 16 bytes of an IPv6 address as URL writes it (lowercase hex groups,
// `::` compression, no dotted tail), or null.
function v6Bytes(s: string): number[] | null {
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups = halves.length === 2
    ? [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail]
    : head;
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  return bytes;
}

function isPrivateV6(s: string): boolean {
  const b = v6Bytes(s);
  if (!b) return true; // unparseable: refuse, as the proxy does
  const v4At = (i: number): number => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
  const zeroUntil = (n: number): boolean => b.slice(0, n).every((x) => x === 0);
  if (zeroUntil(15) && b[15]! <= 1) return true; // :: and ::1
  if ((b[0]! & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (b[0] === 0xfe && b[1]! >= 0x80) return true; // fe80::/10 link-local, fec0::/10 site-local
  if (b[0] === 0xff) return true; // multicast
  // IPv4 inside IPv6: judge the embedded address.
  if (zeroUntil(10) && b[10] === 0xff && b[11] === 0xff) return isPrivateV4Int(v4At(12)); // ::ffff:0:0/96
  if (zeroUntil(12)) return isPrivateV4Int(v4At(12)); // ::/96 IPv4-compatible
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) {
    return isPrivateV4Int(v4At(12)); // 64:ff9b::/96 NAT64
  }
  if (b[0] === 0x20 && b[1] === 0x02) return isPrivateV4Int(v4At(2)); // 2002::/16 6to4
  // 2001::/32 Teredo hides an IPv4 address (obfuscated) and is retired: refuse it whole.
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) return true;
  return false;
}

const LOCAL_NAME = /(^|\.)(localhost|local|internal|lan|home\.arpa)$/;
const V4_LITERAL = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// `u.hostname` is already canonical: URL parsing normalises IPv4 (`0x7f.1` →
// `127.0.0.1`) and IPv6 (`[::ffff:127.0.0.1]` → `[::ffff:7f00:1]`).
export function isPrivateHost(u: URL): boolean {
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[')) return isPrivateV6(host.slice(1, -1));
  if (V4_LITERAL.test(host)) return isPrivateV4Int(v4(host));
  if (!host.includes('.')) return true; // localhost, intranet names
  return LOCAL_NAME.test(host);
}
