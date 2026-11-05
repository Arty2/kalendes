// @vitest-environment happy-dom
import { installTapSwallow, swallowRestOfTap } from './tap-swallow';

describe('swallowRestOfTap', () => {
  it('keeps the rest of the tap from every other listener, then lets taps through', () => {
    installTapSwallow();
    const heard: string[] = [];
    const btn = document.createElement('button');
    document.body.append(btn);
    for (const t of ['pointerup', 'click', 'dblclick']) {
      window.addEventListener(t, () => heard.push('window:' + t), true);
      btn.addEventListener(t, () => heard.push('button:' + t));
    }
    swallowRestOfTap(500);
    btn.dispatchEvent(new Event('pointerup', { bubbles: true }));
    btn.dispatchEvent(new Event('click', { bubbles: true }));
    btn.dispatchEvent(new Event('dblclick', { bubbles: true }));
    expect(heard).toEqual([]);
    // The dblclick ends it: the next tap is heard.
    btn.dispatchEvent(new Event('click', { bubbles: true }));
    expect(heard).toEqual(['window:click', 'button:click']);
    btn.remove();
  });

  it('stops by itself once the time is up', () => {
    vi.useFakeTimers();
    const heard: string[] = [];
    const onClick = (): void => void heard.push('click');
    window.addEventListener('click', onClick);
    swallowRestOfTap(500);
    window.dispatchEvent(new Event('click'));
    vi.advanceTimersByTime(501);
    window.dispatchEvent(new Event('click'));
    expect(heard).toEqual(['click']);
    window.removeEventListener('click', onClick);
    vi.useRealTimers();
  });
});
