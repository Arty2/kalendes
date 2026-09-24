// @vitest-environment happy-dom
import { createPointerDrag, type DragSession, type DragSource } from './event-drag-gesture';

type Ptr = 'mouse' | 'touch' | 'pen';
function ptr(type: Ptr, x: number, y = 0, id = 1): PointerEvent {
  return { pointerType: type, pointerId: id, clientX: x, clientY: y, button: 0, currentTarget: null } as unknown as PointerEvent;
}

// A source that records what the drag did.
function recorder(refuse = false) {
  const log: string[] = [];
  const source: DragSource = (part, x, y) => {
    if (refuse) return null;
    log.push(`begin ${part} ${x},${y}`);
    const s: DragSession = {
      move: (mx, my) => log.push(`move ${mx},${my}`),
      end: (commit) => log.push(commit ? 'commit' : 'cancel'),
    };
    return s;
  };
  return { log, source };
}

describe('createPointerDrag', () => {
  it('lets a mouse press released inside the slop stay a click', () => {
    const r = recorder();
    const d = createPointerDrag(() => r.source);
    d.down(ptr('mouse', 0), 'body');
    expect(d.move(ptr('mouse', 4))).toBe('pending');
    expect(d.up(ptr('mouse', 4))).toBe(false);
    expect(d.consumeClick()).toBe(false);
    expect(r.log).toEqual([]);
  });

  it('starts a mouse drag past the slop, then commits and swallows the click', () => {
    const r = recorder();
    let began = 0;
    const d = createPointerDrag(() => r.source, { onBegin: () => began++ });
    d.down(ptr('mouse', 0, 5), 'body');
    expect(d.move(ptr('mouse', 30, 5))).toBe('dragging');
    expect(d.dragging).toBe(true);
    expect(d.holding).toBe(true);
    d.move(ptr('mouse', 60, 5));
    expect(d.up(ptr('mouse', 60, 5))).toBe(true);
    expect(r.log).toEqual(['begin body 0,5', 'move 30,5', 'move 60,5', 'commit']);
    expect(began).toBe(1);
    expect(d.consumeClick()).toBe(true);
    expect(d.consumeClick()).toBe(false);
  });

  it('treats an unheld touch that travels as a scroll', () => {
    const r = recorder();
    const d = createPointerDrag(() => r.source);
    d.down(ptr('touch', 0), 'body');
    expect(d.holding).toBe(false);
    expect(d.move(ptr('touch', 40))).toBe('dropped');
    expect(d.move(ptr('touch', 80))).toBe('idle');
    expect(r.log).toEqual([]);
  });

  it('drags a touch once the hold has armed it', () => {
    const r = recorder();
    const d = createPointerDrag(() => r.source);
    d.down(ptr('touch', 0), 'start');
    d.arm();
    // Armed: the pill must now block native scrolling.
    expect(d.holding).toBe(true);
    expect(d.move(ptr('touch', 3))).toBe('pending');
    expect(d.move(ptr('touch', 40))).toBe('dragging');
    d.up(ptr('touch', 40));
    expect(r.log[0]).toBe('begin start 0,0');
    expect(r.log.at(-1)).toBe('commit');
  });

  it('cancels on Escape without committing', () => {
    const r = recorder();
    const d = createPointerDrag(() => r.source);
    d.down(ptr('mouse', 0), 'body');
    d.move(ptr('mouse', 30));
    const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    window.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(r.log.at(-1)).toBe('cancel');
    expect(d.dragging).toBe(false);
    // The release that follows is not a drop.
    expect(d.up(ptr('mouse', 30))).toBe(false);
    expect(r.log.filter((l) => l === 'commit')).toEqual([]);
    // Escape after the drag is over is left alone.
    const later = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    window.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });

  it('cancels on pointercancel', () => {
    const r = recorder();
    const d = createPointerDrag(() => r.source);
    d.down(ptr('pen', 0), 'body');
    d.move(ptr('pen', 30));
    d.cancel();
    expect(r.log.at(-1)).toBe('cancel');
  });

  it('does nothing for a read-only pill or a refused part', () => {
    const none = createPointerDrag(() => null);
    none.down(ptr('mouse', 0), 'body');
    expect(none.move(ptr('mouse', 50))).toBe('idle');

    const r = recorder(true);
    const refused = createPointerDrag(() => r.source);
    refused.down(ptr('mouse', 0), 'end');
    expect(refused.move(ptr('mouse', 50))).toBe('dropped');
    expect(refused.dragging).toBe(false);
  });

  it('ignores other pointers and non-primary mouse buttons', () => {
    const r = recorder();
    const d = createPointerDrag(() => r.source);
    d.down({ ...ptr('mouse', 0), button: 2 } as PointerEvent, 'body');
    expect(d.move(ptr('mouse', 50))).toBe('idle');
    d.down(ptr('touch', 0, 0, 1), 'body');
    expect(d.move(ptr('touch', 50, 0, 2))).toBe('idle');
  });

  it('forgets a stale swallowed click on the next press', () => {
    const r = recorder();
    const d = createPointerDrag(() => r.source);
    d.down(ptr('mouse', 0), 'body');
    d.move(ptr('mouse', 30));
    d.up(ptr('mouse', 30)); // no click followed (e.g. touch)
    d.down(ptr('mouse', 0), 'body');
    d.up(ptr('mouse', 0));
    expect(d.consumeClick()).toBe(false);
  });
});
