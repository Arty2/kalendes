// @vitest-environment happy-dom
import { createDragReorder } from './drag-reorder.svelte';

function pe(type: string, id: number, primary: boolean): PointerEvent {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperty(ev, 'pointerId', { value: id });
  Object.defineProperty(ev, 'pointerType', { value: 'touch' });
  Object.defineProperty(ev, 'isPrimary', { value: primary });
  Object.defineProperty(ev, 'clientX', { value: 0 });
  Object.defineProperty(ev, 'clientY', { value: 0 });
  return ev;
}

describe('createDragReorder', () => {
  it('drops the reorder when a second finger lands (a pinch), committing nothing', () => {
    const onReorder = vi.fn();
    const dnd = createDragReorder({ getOrderedIds: () => ['a', 'b'], getRowEl: () => undefined, onReorder });
    dnd.startDrag(pe('pointerdown', 1, true), 'a');
    expect(dnd.draggingId).toBe('a');
    window.dispatchEvent(pe('pointerdown', 2, false));
    expect(dnd.draggingId).toBeNull();
    window.dispatchEvent(pe('pointerup', 1, true));
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('ignores a second finger as a drag of its own', () => {
    const dnd = createDragReorder({ getOrderedIds: () => ['a', 'b'], getRowEl: () => undefined, onReorder: vi.fn() });
    dnd.startDrag(pe('pointerdown', 2, false), 'b');
    expect(dnd.draggingId).toBeNull();
  });
});
