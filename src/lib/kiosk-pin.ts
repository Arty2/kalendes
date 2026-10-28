// The kiosk PIN is never kept or shared as typed: config.kioskPin and share
// links hold a salted, deliberately slow PBKDF2 hash of it, so reading a link
// or the device's storage doesn't reveal it. A short numeric PIN can still be
// found by trying every one (a million 6-digit PINs at ~0.3s each is days of
// computing, not seconds): this keeps the lock out of casual view, it doesn't
// make it a secret.
//
// Stored form: `p1.<length>.<iterations>.<salt>.<hash>` (base64url). Configs
// and links from before hashing hold the 4 digits themselves ("legacy"); they
// still unlock, and App rewrites a stored one as a hash at launch.

export const PIN_LENGTH = 6;
export const PIN_ITERATIONS = 600_000;
// A crafted link can't make an unlock attempt hang the page.
const MAX_ITERATIONS = 5_000_000;
const HASH_RE = /^p1\.(4|6)\.(\d{1,7})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
const LEGACY_RE = /^\d{4}$/;

export function isPinHash(stored: unknown): stored is string {
  if (typeof stored !== 'string') return false;
  const m = HASH_RE.exec(stored);
  return m != null && Number(m[2]) >= 1 && Number(m[2]) <= MAX_ITERATIONS;
}

export function isLegacyPin(stored: unknown): stored is string {
  return typeof stored === 'string' && LEGACY_RE.test(stored);
}

// What config.kioskPin may hold.
export function isStoredPin(stored: unknown): stored is string {
  return isPinHash(stored) || isLegacyPin(stored);
}

// How many digits unlocking a stored PIN takes.
export function pinLength(stored: string | null): number {
  if (isLegacyPin(stored)) return 4;
  const m = stored ? HASH_RE.exec(stored) : null;
  return m ? Number(m[1]) : PIN_LENGTH;
}

export function isPinShape(pin: string, length = PIN_LENGTH): boolean {
  return pin.length === length && /^\d+$/.test(pin);
}

function toB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPin(pin: string, iterations = PIN_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, iterations);
  return `p1.${pin.length}.${iterations}.${toB64Url(salt)}.${toB64Url(hash)}`;
}

export async function verifyPin(pin: string, stored: string | null): Promise<boolean> {
  if (stored == null) return false;
  if (isLegacyPin(stored)) return pin === stored;
  if (!isPinHash(stored)) return false;
  const [, length, iterations, salt, hash] = HASH_RE.exec(stored)!;
  if (pin.length !== Number(length)) return false;
  const got = await derive(pin, fromB64Url(salt!), Number(iterations));
  const want = fromB64Url(hash!);
  let diff = got.length ^ want.length;
  for (let i = 0; i < got.length; i++) diff |= got[i]! ^ (want[i] ?? 0);
  return diff === 0;
}
