import { swStatus, watchSwUpdates, scheduleSwUpdateChecks, SW_CHECK_MIN_GAP_MS, SW_CHECK_EVERY_MS } from './sw-status.svelte';

class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installing';
  to(state: ServiceWorkerState): void {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}
class FakeReg extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  find(w: FakeWorker): void {
    this.installing = w;
    this.dispatchEvent(new Event('updatefound'));
  }
}
const asReg = (r: FakeReg) => r as unknown as ServiceWorkerRegistration;
const container = (controlled: boolean) =>
  ({ controller: controlled ? {} : null }) as unknown as ServiceWorkerContainer;

describe('watchSwUpdates', () => {
  beforeEach(() => {
    swStatus.updating = false;
  });

  it('flags an update over a controlling worker until it activates', () => {
    const reg = new FakeReg();
    watchSwUpdates(asReg(reg), container(true));
    const w = new FakeWorker();
    reg.find(w);
    expect(swStatus.updating).toBe(true);
    w.to('installed');
    expect(swStatus.updating).toBe(true);
    w.to('activated');
    expect(swStatus.updating).toBe(false);
  });

  it('clears when the new worker fails to install', () => {
    const reg = new FakeReg();
    watchSwUpdates(asReg(reg), container(true));
    const w = new FakeWorker();
    reg.find(w);
    w.to('redundant');
    expect(swStatus.updating).toBe(false);
  });

  it('ignores the first install', () => {
    const reg = new FakeReg();
    watchSwUpdates(asReg(reg), container(false));
    reg.find(new FakeWorker());
    expect(swStatus.updating).toBe(false);
  });

  it('picks up an update already installing at registration', () => {
    const reg = new FakeReg();
    reg.installing = new FakeWorker();
    watchSwUpdates(asReg(reg), container(true));
    expect(swStatus.updating).toBe(true);
  });
});

describe('scheduleSwUpdateChecks', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(online = true) {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'hidden' }) as unknown as Document & { visibilityState: string };
    const nav = { onLine: online };
    const reg = { update: vi.fn(() => Promise.resolve()) };
    const stop = scheduleSwUpdateChecks(reg as unknown as ServiceWorkerRegistration, { doc, nav });
    const show = (): void => {
      (doc as { visibilityState: string }).visibilityState = 'visible';
      doc.dispatchEvent(new Event('visibilitychange'));
    };
    const hide = (): void => {
      (doc as { visibilityState: string }).visibilityState = 'hidden';
      doc.dispatchEvent(new Event('visibilitychange'));
    };
    return { reg, nav, show, hide, stop };
  }

  it('checks when the tab comes back, at most every few minutes', () => {
    const { reg, show, hide } = setup();
    show(); // right after registering: too soon
    expect(reg.update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SW_CHECK_MIN_GAP_MS);
    hide();
    show();
    expect(reg.update).toHaveBeenCalledTimes(1);
    hide();
    show(); // just checked
    expect(reg.update).toHaveBeenCalledTimes(1);
  });

  it('checks once a day while open, and stops when cleaned up', () => {
    const { reg, stop } = setup();
    vi.advanceTimersByTime(SW_CHECK_EVERY_MS);
    expect(reg.update).toHaveBeenCalledTimes(1);
    stop();
    vi.advanceTimersByTime(SW_CHECK_EVERY_MS);
    expect(reg.update).toHaveBeenCalledTimes(1);
  });

  it('skips checks while offline', () => {
    const { reg, show } = setup(false);
    vi.advanceTimersByTime(SW_CHECK_EVERY_MS);
    show();
    expect(reg.update).not.toHaveBeenCalled();
  });
});
