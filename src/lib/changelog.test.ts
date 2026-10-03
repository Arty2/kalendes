import { CHANGELOG, parseChangelog, releaseSignature, whatsNewOnStartup } from './changelog';

const SAMPLE = `# Changelog

Preamble with a \`code\` span and
- a dash line that is not a release.

## 0.2.1 — 2026-10-02

- First, with \`code\` inside.
- A wrapped bullet
  that continues here.

## 0.1.0 - 2026-09-20

- What 0.1 brought.
`;

describe('parseChangelog', () => {
  it('reads releases newest first, skipping the preamble', () => {
    const releases = parseChangelog(SAMPLE);
    expect(releases.map((r) => [r.version, r.date])).toEqual([
      ['0.2.1', '2026-10-02'],
      ['0.1.0', '2026-09-20'],
    ]);
  });

  it('splits code runs and joins wrapped bullets', () => {
    const [latest] = parseChangelog(SAMPLE);
    expect(latest.items).toEqual([
      [
        { text: 'First, with ', code: false },
        { text: 'code', code: true },
        { text: ' inside.', code: false },
      ],
      [{ text: 'A wrapped bullet that continues here.', code: false }],
    ]);
  });

  it('parses the bundled CHANGELOG.md, headed by the app version', () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
    expect(CHANGELOG[0].version).toBe(__APP_VERSION__);
    expect(CHANGELOG[0].items.length).toBeGreaterThan(0);
  });
});

describe('releaseSignature', () => {
  it('ignores a patch that only rewrites the heading', () => {
    const [a] = parseChangelog(SAMPLE);
    const [b] = parseChangelog(SAMPLE.replace('## 0.2.1 — 2026-10-02', '## 0.2.2 — 2026-10-05'));
    expect(releaseSignature(b)).toBe(releaseSignature(a));
  });

  it('changes when a release gains a line or a new minor starts', () => {
    const [a] = parseChangelog(SAMPLE);
    const [b] = parseChangelog(SAMPLE.replace('- First,', '- New.\n- First,'));
    expect(releaseSignature(b)).not.toBe(releaseSignature(a));
    const [c] = parseChangelog(SAMPLE.replace('## 0.2.1', '## 0.3.0'));
    expect(releaseSignature(c)).not.toBe(releaseSignature(a));
  });
});

describe('whatsNewOnStartup', () => {
  it('marks a first run read, opens on something new, else stays shut', () => {
    expect(whatsNewOnStartup(null, 'x')).toBe('mark');
    expect(whatsNewOnStartup('old', 'x')).toBe('open');
    expect(whatsNewOnStartup('x', 'x')).toBe('none');
    expect(whatsNewOnStartup(null, '')).toBe('none');
  });
});
