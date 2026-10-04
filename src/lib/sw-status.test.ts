import { swStatus, watchSwUpdates } from './sw-status.svelte';

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
