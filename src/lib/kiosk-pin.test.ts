import { hashPin, isPinHash, verifyPin } from './kiosk-pin';

describe('kiosk PIN hashing', () => {
  it('stores a salted hash that verifies only the same PIN', async () => {
    const stored = await hashPin('1234', 1000);
    expect(isPinHash(stored)).toBe(true);
    expect(stored).not.toContain('1234');
    expect(await hashPin('1234', 1000)).not.toBe(stored); // salted
    expect(await verifyPin('1234', stored)).toBe(true);
    expect(await verifyPin('1235', stored)).toBe(false);
    expect(await verifyPin('123', stored)).toBe(false);
  });

  it('rejects plain digits and malformed or runaway stored values', async () => {
    const ok = await hashPin('1234', 1000);
    for (const bad of ['', '4321', '1234', 'p1.4.1000.x.y', ok.replace('.1000.', '.9999999.'), ok.replace('p1.4.', 'p1.6.'), ok + 'A', null, 42]) {
      expect(isPinHash(bad), String(bad)).toBe(false);
    }
    expect(await verifyPin('4321', '4321')).toBe(false);
    expect(await verifyPin('1234', ok.replace('.1000.', '.9999999.'))).toBe(false);
    expect(await verifyPin('1234', null)).toBe(false);
  });
});
