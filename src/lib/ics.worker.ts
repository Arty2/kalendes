import { parseIcsExtended } from './ics-core';

type ParseRequest = {
  id: number;
  ics: string;
  feedId: string;
  rangeStart: Date;
  rangeEnd: Date;
};

// `self` is the DedicatedWorkerGlobalScope here; the project's tsconfig only
// pulls in DOM libs, so narrow to the message API we actually use.
const ctx = self as unknown as {
  onmessage: ((ev: MessageEvent<ParseRequest>) => void) | null;
  postMessage: (msg: unknown) => void;
};

ctx.onmessage = (ev) => {
  const { id, ics, feedId, rangeStart, rangeEnd } = ev.data;
  try {
    const result = parseIcsExtended(ics, feedId, rangeStart, rangeEnd);
    ctx.postMessage({ id, result });
  } catch (e) {
    ctx.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
