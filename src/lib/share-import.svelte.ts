// What happens to an opened share link — the one place it's decided. App
// decodes a link and hands it to openShareImport, which asks
// decideShareImport (share.ts) once with this device's state and acts on the
// answer: refuse with a note, import straight away, or open the import dialog,
// whose buttons come back here (applyShareImport). The dialog only shows a
// link and applies the choice; it decides nothing.

import {
  ui, config, zoom, events, isKiosk,
  createImportedLane, addEventsToLane, setFeedHidden, removeLocalLane, clearDraftLane,
} from './state.svelte';
import { decideShareImport, stripShareParam, type DecodedShare } from './share';
import { viewport } from './viewport.svelte';
import { canCheckPins } from './kiosk-pin';
import { clearKioskHome } from './kiosk-idle';
import { isDefaultOnlyFeeds, isDefaultOnlyRules, scratchpadFeed, uniqueFeedId } from './storage';
import { forgetChangedFeeds } from './feed-loader.svelte';
import { SCRATCHPAD_FEED_ID } from './types';
import type { ShareImportDecision } from './types';

const REFUSALS: Record<Extract<ShareImportDecision, { action: 'refuse' }>['reason'], string> = {
  locked: 'This device is in kiosk mode. Unlock it with its PIN, then open the link again.',
  insecure: 'This link sets up a kiosk lock, which needs the app opened over https. Nothing was imported.',
  cut: 'The link was cut short. Nothing was imported: open the whole link on this display.',
};

// Only the default feeds and rules and an empty Draft: nothing a link could
// overwrite that the user made.
function isFresh(): boolean {
  return (
    isDefaultOnlyFeeds(config.feeds) &&
    isDefaultOnlyRules($state.snapshot(config.rules)) &&
    (events.byFeed[SCRATCHPAD_FEED_ID]?.length ?? 0) === 0
  );
}

function decide(link: DecodedShare): ShareImportDecision {
  return decideShareImport(
    { kiosk: link.kioskPin != null, truncated: link.truncated },
    { locked: isKiosk(), noPointer: viewport.noPointer, fresh: isFresh(), canCheckPins: canCheckPins() },
  );
}

export function openShareImport(link: DecodedShare): void {
  const decision = decide(link);
  if (decision.action === 'refuse') {
    stripShareParam();
    ui.shareImport = null;
    ui.errorModal = { title: 'Shared link not imported', feedName: '', message: REFUSALS[decision.reason] };
  } else if (decision.action === 'auto') {
    commit(link, 'replace', decision.sign);
  } else {
    ui.shareImport = link;
  }
}

// The import dialog's Replace / Merge. Asks again first: the device may have
// been locked since the dialog opened, and a link must never get past a refusal.
export function applyShareImport(link: DecodedShare, mode: 'replace' | 'merge'): void {
  const decision = decide(link);
  if (decision.action === 'refuse') {
    openShareImport(link);
    return;
  }
  commit(link, mode, decision.action === 'auto' && decision.sign);
}

// Cancel, or the dialog closed: drop the link from the address too, so a
// reload doesn't offer it again.
export function closeShareImport(): void {
  ui.shareImport = null;
  stripShareParam();
}

function commit(link: DecodedShare, mode: 'replace' | 'merge', sign: boolean): void {
  if (mode === 'replace') replace(link, sign);
  else merge(link);
  applyView(link);
  if (link.kioskPin) config.kioskPin = link.kioskPin;
  // What the link set up is the kiosk's home now.
  clearKioskHome();
  ui.kioskHomeRev++;
  closeShareImport();
}

// Whether this device already has a linked calendar at this address: Merge
// skips it, and the dialog marks it so.
export function existingUrl(url: string): boolean {
  return config.feeds.some((f) => f.source.kind === 'user' && f.source.url === url);
}

function nextOrder(): number {
  return config.feeds.reduce((m, f) => Math.max(m, f.order), -1) + 1;
}

function applyView(link: DecodedShare): void {
  const v = link.view;
  if (!v) return;
  if (v.zoom) zoom.value = v.zoom;
  if (v.locale) config.locale = v.locale;
  if (v.dateFormat) config.dateFormat = v.dateFormat;
  if (v.scheme) config.scheme = v.scheme;
  if (v.palette) config.palette = v.palette;
}

// The shared local lanes. The sender's built-in Draft (isDraft) merges into the
// recipient's own Draft — its events appended, its enabled state restored — so
// there's never a duplicate "Draft"; every other local lane becomes a fresh
// scratchpad lane (uuid id).
function applyLocalFeeds(link: DecodedShare): void {
  for (const lf of link.localFeeds) {
    if (lf.isDraft) {
      addEventsToLane(SCRATCHPAD_FEED_ID, lf.events);
      setFeedHidden(SCRATCHPAD_FEED_ID, !!lf.hidden);
      if (lf.subLanes) {
        const draft = config.feeds.find((f) => f.id === SCRATCHPAD_FEED_ID);
        if (draft) draft.subLanes = lf.subLanes;
      }
      continue;
    }
    createImportedLane(lf.name, lf.events, {
      category: lf.category,
      timezone: lf.timezone,
      hidden: lf.hidden,
      subLanes: lf.subLanes,
    });
  }
}

function merge(link: DecodedShare): void {
  let order = nextOrder();
  for (const feed of link.feeds) {
    if (feed.source.kind !== 'user') continue;
    if (existingUrl(feed.source.url)) continue;
    config.feeds.push({ ...feed, id: uniqueFeedId(feed.id, config.feeds), order: order++ });
  }
  const existingRuleIds = new Set(config.rules.map((r) => r.id));
  for (const rule of link.rules) {
    if (existingRuleIds.has(rule.id)) continue;
    config.rules.push(rule);
  }
  applyLocalFeeds(link);
}

// `sign`: a display with no setup of its own to keep — its Draft takes the
// link's, so sending a link again doesn't stack another copy of its events.
function replace(link: DecodedShare, sign: boolean): void {
  // Preserve the recipient's own Draft lane across the wholesale replace — the
  // decoded feeds are all URL feeds, so without this the Draft would vanish
  // until a reload re-injected a fresh (forced-hidden) one.
  const draft = config.feeds.find((f) => f.id === SCRATCHPAD_FEED_ID) ?? scratchpadFeed(0);
  const replaced = link.feeds.map((f, i) => ({ ...f, order: i }));
  const before = $state.snapshot(config.feeds) as typeof config.feeds;
  config.feeds = [...replaced, { ...draft, order: replaced.length }];
  // A kept id may now point at another URL: drop what its old one left.
  forgetChangedFeeds(before, config.feeds);
  // Imported lanes the replace dropped: their stored events would otherwise
  // stay in localStorage with nothing pointing at them.
  for (const f of before) {
    if (f.source.kind === 'scratchpad' && f.id !== SCRATCHPAD_FEED_ID) removeLocalLane(f.id);
  }
  if (sign) clearDraftLane();
  config.rules = [...link.rules];
  applyLocalFeeds(link);
}
