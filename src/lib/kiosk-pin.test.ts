import { hashPin, isLegacyPin, isPinHash, isStoredPin, pinLength, verifyPin } from './kiosk-pin';

describe('kiosk PIN hashing', () => {
  it('stores a salted hash that verifies only the same PIN', async () => {
    const stored = await hashPin('123456', 1000);
    expect(isPinHash(stored)).toBe(true);
    expect(stored).not.toContain('123456');
    expect(await hashPin('123456', 1000)).not.toBe(stored); // salted
    expect(await verifyPin('123456', stored)).toBe(true);
    expect(await verifyPin('123457', stored)).toBe(false);
    expect(await verifyPin('1234', stored)).toBe(false);
    expect(pinLength(stored)).toBe(6);
  });

  it('keeps a 4-digit PIN from before hashing working', async () => {
    expect(isLegacyPin('4321')).toBe(true);
    expect(isStoredPin('4321')).toBe(true);
    expect(pinLength('4321')).toBe(4);
    expect(await verifyPin('4321', '4321')).toBe(true);
    expect(await verifyPin('1234', '4321')).toBe(false);
    const upgraded = await hashPin('4321', 1000);
    expect(pinLength(upgraded)).toBe(4);
    expect(await verifyPin('4321', upgraded)).toBe(true);
  });

  it('rejects malformed or runaway stored values', async () => {
    const ok = await hashPin('123456', 1000);
    for (const bad of ['', '12345', '123456', 'p1.6.1000.x.y', ok.replace('.1000.', '.9999999.'), ok + 'A', null, 42]) {
      expect(isStoredPin(bad), String(bad)).toBe(false);
    }
    expect(await verifyPin('123456', ok.replace('.1000.', '.9999999.'))).toBe(false);
    expect(await verifyPin('123456', null)).toBe(false);
  });
});
