// Unsaved edits kept in this browser, so a reload doesn't lose work in progress. A draft only comes back
// for the exact saved configuration it was made against (version + save time); after any save, a demo
// reset, or someone else's change, it's dropped. Nothing here is authoritative: saving goes to the server.
const PREFIX = "ccplannie:draft:";
type Stamped = { config: { version: number; updatedAt: string | null } };
const stampOf = (c: Stamped) => `${c.config.version}:${c.config.updatedAt ?? ""}`;

export function loadDraft<T>(key: string, co: Stamped): T | null {
  try {
    const x = JSON.parse(localStorage.getItem(PREFIX + key) || "null");
    if (x && x.stamp === stampOf(co)) return x.data as T;
    localStorage.removeItem(PREFIX + key);
  } catch { /* storage unavailable: start from the saved configuration */ }
  return null;
}
export function saveDraft(key: string, co: Stamped, data: unknown) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify({ stamp: stampOf(co), data })); } catch { /* ignore */ }
}
export function dropDraft(key: string) {
  try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
}
// Everything the console keeps locally (unsaved drafts). Used by the sidebar's "Clear cache".
// Pages listen for DRAFTS_CLEARED and reload the saved configuration in place.
export const DRAFTS_CLEARED = "console:drafts-cleared";
export function clearDrafts() {
  try { Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
  window.dispatchEvent(new Event(DRAFTS_CLEARED));
}
