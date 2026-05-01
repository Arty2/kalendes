/// <reference types="svelte" />
/// <reference types="vite/client" />

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
