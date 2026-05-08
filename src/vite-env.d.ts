/// <reference types="svelte" />
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __APP_VERSION__: string;
declare const __APP_HOMEPAGE__: string;

declare module 'ical-expander' {
  import type ICAL from 'ical.js';
  export default class IcalExpander {
    constructor(opts: { ics: string; maxIterations?: number });
    between(start: Date, end: Date): {
      events: ICAL.Event[];
      occurrences: { startDate: ICAL.Time; endDate: ICAL.Time; item: ICAL.Event; recurrenceId?: ICAL.Time }[];
    };
    before(end: Date): unknown;
    after(start: Date): unknown;
    all(): unknown;
  }
}
