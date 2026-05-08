// Vitest global setup.
//
// Run the suite in a non-UTC timezone so date-only iCal handling stays
// timezone-agnostic. Without this the parser regression test for Mother's
// Day passes in CI (UTC) but the real bug only manifests in browsers like
// Europe/Athens. Athens is UTC+3 in DST so it surfaces local-vs-UTC drift.
process.env.TZ = 'Europe/Athens';
