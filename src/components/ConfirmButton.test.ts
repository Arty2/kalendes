import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ConfirmButton from './ConfirmButton.svelte';

describe('ConfirmButton', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('3-stage: idle → confirm → done → commit on cooldown', async () => {
    const onCommit = vi.fn();
    const onArm = vi.fn();
    const { getByRole } = render(ConfirmButton, { label: 'Delete', onCommit, onArm });
    const btn = getByRole('button');

    expect(btn.dataset.state).toBe('idle');
    await fireEvent.click(btn);
    expect(btn.dataset.state).toBe('confirm');

    await fireEvent.click(btn);
    expect(btn.dataset.state).toBe('done');
    expect(onArm).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3000);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(btn.dataset.state).toBe('idle');
  });

  it('3-stage: a tap during the cooldown undoes and never commits', async () => {
    const onCommit = vi.fn();
    const onUndo = vi.fn();
    const { getByRole } = render(ConfirmButton, { label: 'Delete', onCommit, onUndo });
    const btn = getByRole('button');

    await fireEvent.click(btn); // confirm
    await fireEvent.click(btn); // done
    await fireEvent.click(btn); // undo
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(btn.dataset.state).toBe('undo');

    await vi.advanceTimersByTimeAsync(3000);
    expect(onCommit).not.toHaveBeenCalled();
    expect(btn.dataset.state).toBe('idle');
  });

  it('confirm reverts to idle if left untouched', async () => {
    const onCommit = vi.fn();
    const { getByRole } = render(ConfirmButton, { label: 'Delete', onCommit });
    const btn = getByRole('button');

    await fireEvent.click(btn);
    expect(btn.dataset.state).toBe('confirm');
    await vi.advanceTimersByTimeAsync(3000);
    expect(btn.dataset.state).toBe('idle');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('2-stage: commits on the second tap and never fires onCommit', async () => {
    const onConfirm = vi.fn();
    const onCommit = vi.fn();
    const { getByRole } = render(ConfirmButton, { label: 'Reset', stages: 2, onConfirm, onCommit });
    const btn = getByRole('button');

    await fireEvent.click(btn);
    expect(btn.dataset.state).toBe('confirm');
    await fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
    expect(btn.dataset.state).toBe('idle');
  });

  it('disabled buttons ignore clicks', async () => {
    const onCommit = vi.fn();
    const { getByRole } = render(ConfirmButton, { label: 'Delete', disabled: true, onCommit });
    const btn = getByRole('button');
    await fireEvent.click(btn);
    expect(btn.dataset.state).toBe('idle');
  });
});
