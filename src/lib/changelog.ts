// CHANGELOG.md, bundled at build time and parsed — never rendered as Markdown.
// Release headings are `## X.Y.Z — YYYY-MM-DD` (the shape scripts/gates.sh
// checks); bullets are plain text with `code` runs, so that is all this reads.
import changelogSource from '../../CHANGELOG.md?raw';

export interface ChangelogRun {
  text: string;
  code: boolean;
}

export interface ChangelogRelease {
  version: string;
  date: string;
  items: ChangelogRun[][];
}

const HEADING = /^## (\d+\.\d+\.\d+)\s+[—–-]\s+(\d{4}-\d{2}-\d{2})\s*$/;

function splitCode(text: string): ChangelogRun[] {
  return text
    .split(/`([^`]*)`/)
    .map((part, i) => ({ text: part, code: i % 2 === 1 }))
    .filter((run) => run.text !== '');
}

export function parseChangelog(source: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let current: ChangelogRelease | null = null;
  let bullet: string | null = null;
  const flush = (): void => {
    if (current && bullet != null) current.items.push(splitCode(bullet));
    bullet = null;
  };
  for (const line of source.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      flush();
      const m = HEADING.exec(line);
      current = m ? { version: m[1], date: m[2], items: [] } : null;
      if (current) releases.push(current);
    } else if (!current) {
      // The preamble above the first release is for people reading the file.
    } else if (line.startsWith('- ')) {
      flush();
      bullet = line.slice(2).trim();
    } else if (line.trim() === '') {
      flush();
    } else if (bullet != null) {
      // A wrapped bullet continues on the next (indented) line.
      bullet += ' ' + line.trim();
    }
  }
  flush();
  return releases;
}

export const CHANGELOG: ChangelogRelease[] = parseChangelog(changelogSource);

// --- Opening it once after an update ------------------------------------------
// Keyed on the latest release's lines, not the version: a patch that only
// rewrites its minor's heading brings nothing new to read.
export const WHATS_NEW_KEY = 'calendar-timeline:whats-new-seen';

export function releaseSignature(release: ChangelogRelease | undefined): string {
  if (!release) return '';
  const text = release.items.map((runs) => runs.map((r) => r.text).join('')).join('\n');
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${release.version.split('.').slice(0, 2).join('.')}:${h.toString(36)}`;
}

// 'mark': a first run — the onboarding is the introduction, so the current
// release counts as read. 'open': something new since the last read.
export function whatsNewOnStartup(seen: string | null, signature: string): 'open' | 'mark' | 'none' {
  if (!signature) return 'none';
  if (seen == null) return 'mark';
  return seen === signature ? 'none' : 'open';
}

export function readWhatsNewSeen(): string | null {
  try {
    return localStorage.getItem(WHATS_NEW_KEY);
  } catch {
    return null;
  }
}

export function markWhatsNewSeen(signature: string = releaseSignature(CHANGELOG[0])): void {
  try {
    localStorage.setItem(WHATS_NEW_KEY, signature);
  } catch {
    // Private mode / quota: it just opens again next time.
  }
}
