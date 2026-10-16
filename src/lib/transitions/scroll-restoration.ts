// The router saves scroll only once scrolling stops, which Lenis's easing tail delays, so leaving stamps it exactly.
// Chrome drops this write for a reload, which restores from the session stamp instead. See `docs/features/view-transitions.md`.

import { RELOAD_STAMP_KEY, scrollAnchorAt } from "./scroll-anchor";

const stamp = () => {
  const x = window.scrollX;
  const y = window.scrollY;
  const anchor = scrollAnchorAt(y);

  if (history.state) {
    history.replaceState({ ...history.state, scrollX: x, scrollY: y, scrollAnchor: anchor }, "");
  }

  return { x, y, anchor };
};

// A reload or a full navigation fires pagehide; a tab the system discards in the background only ever goes hidden.
addEventListener("pagehide", () => {
  try {
    sessionStorage.setItem(RELOAD_STAMP_KEY, JSON.stringify({ href: location.href, ...stamp() }));
  } catch {
    // Storage can be off (blocked cookies); the reload then falls back to the router's own record.
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    stamp();
  }
});

// The router scrolls a swap and `Web.astro` a document load, so the browser restoring as well would be a second owner.
history.scrollRestoration = "manual";
