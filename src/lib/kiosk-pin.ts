// The kiosk PIN is never kept or shared as typed: config.kioskPin and share
// links hold a salted, deliberately slow PBKDF2 hash of it, so reading a link
// or the device's storage doesn't reveal it. A short numeric PIN can still be
// found by trying every one (10,000 4-digit PINs at ~0.3s each is under an
// hour of computing): this is a lock against casual use, not a secret — the
// link's data isn't encrypted anyway.
//
// Stored form: `p1.<length>.<iterations>.<salt>.<hash>` (base64url).

import { fromBase64Url, toBase64Url } from './base64url';

export const PIN_LENGTH = 4;
export const PIN_ITERATIONS = 600_000;
// A crafted link can't make an unlock attempt hang the page.
const MAX_ITERATIONS = 5_000_000;
const HASH_RE = new RegExp(`^p1\\.(${PIN_LENGTH})\\.(\\d{1,7})\\.([A-Za-z0-9_-]{22})\\.([A-Za-z0-9_-]{43})$`);

// Browsers offer Web Crypto only to secure pages (https, localhost). Without it
// a hashed PIN can be neither set nor checked.
export function canCheckPins(): boolean {
  return typeof crypto !== 'undefined' && typeof crypto.subtle?.deriveBits === 'function';
}

export function isPinHash(stored: unknown): stored is string {
  if (typeof stored !== 'string') return false;
  const m = HASH_RE.exec(stored);
  return m != null && Number(m[2]) >= 1 && Number(m[2]) <= MAX_ITERATIONS;
}

export function isPinShape(pin: string, length = PIN_LENGTH): boolean {
  return pin.length === length && /^\d+$/.test(pin);
}

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPin(pin: string, iterations = PIN_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, iterations);
  return `p1.${pin.length}.${iterations}.${toBase64Url(salt)}.${toBase64Url(hash)}`;
}

export async function verifyPin(pin: string, stored: string | null): Promise<boolean> {
  if (!isPinHash(stored)) return false;
  const [, length, iterations, salt, hash] = HASH_RE.exec(stored)!;
  if (pin.length !== Number(length)) return false;
  const got = await derive(pin, fromBase64Url(salt!), Number(iterations));
  const want = fromBase64Url(hash!);
  let diff = got.length ^ want.length;
  for (let i = 0; i < got.length; i++) diff |= got[i]! ^ (want[i] ?? 0);
  return diff === 0;
}
