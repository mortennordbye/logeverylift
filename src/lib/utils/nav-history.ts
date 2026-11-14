/**
 * Tags each history entry with the app URL it was pushed from.
 *
 * Back controls use the tag to go back to where the user came from (a real
 * history pop, as the iOS edge swipe does) instead of to a fixed parent. See
 * docs/plans/back-navigation.md.
 *
 * The tag lives in `history.state`, which belongs to the entry: the browser
 * keeps it across a reload and drops it with the entry. A full page load (cold
 * start, the login redirect, a pasted URL) makes an entry with no tag, so Back
 * falls back to the page's parent there.
 *
 * It has to wrap `pushState`/`replaceState` before Next's router loads, so it
 * runs as a pre-hydration script in the root layout. Next builds a fresh state
 * object for every write and calls the methods through `window.history`, so the
 * wrapper sees every router navigation. Re-check that on a Next major upgrade.
 *
 * - push: tag = the URL being left.
 * - replace: keep the entry's tag. Next replaces the current entry on every
 *   commit, and `router.replace` takes the place of the entry, not a new step.
 * - Non-object data (never sent by Next) passes through untouched.
 */
export const HISTORY_TAG_SCRIPT = `(function(){var h=window.history;if(h.__lelTagged)return;h.__lelTagged=true;var p=h.pushState,r=h.replaceState;function ok(d){return d===null||d===undefined||(typeof d==="object"&&!Array.isArray(d))}h.pushState=function(d,t,u){if(!ok(d))return p.call(h,d,t,u);var n=Object.assign({},d);n.__lelPrev=location.pathname+location.search;return p.call(h,n,t,u)};h.replaceState=function(d,t,u){if(!ok(d))return r.call(h,d,t,u);var n=Object.assign({},d);var s=h.state;if(s&&typeof s.__lelPrev==="string")n.__lelPrev=s.__lelPrev;else delete n.__lelPrev;return r.call(h,n,t,u)}})()`;

/** The app URL the current entry was pushed from, or null. Client only. */
export function readPrevEntry(): string | null {
  if (typeof window === "undefined") return null;
  const state: unknown = window.history.state;
  if (state && typeof state === "object" && "__lelPrev" in state) {
    const prev = (state as { __lelPrev: unknown }).__lelPrev;
    return typeof prev === "string" ? prev : null;
  }
  return null;
}
