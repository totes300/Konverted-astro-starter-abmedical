// A saved position as the block the top of the screen is in and how far into it, so a block above that changes height
// once its script runs (a runway sized by its script, a scrollbar appearing) cannot move where a restore lands.

/** The blocks a position is anchored to; the restore in `Web.astro` reads the same list. */
export const SCROLL_ANCHORS = "[data-page-builder-section], main > :not(script)";

/** Where a document leaving writes its exact position, for the reload that follows it. */
export const RELOAD_STAMP_KEY = "scroll-restore";

/** Which anchor, how far into it, how many anchors the page had, and the `scrollY` it was taken at. */
export type ScrollAnchor = [index: number, offset: number, count: number, at: number];

// Layout, not painted, position: a block mid-reveal is translated, and a restore lands on layout.
const layoutTop = (element: HTMLElement) => {
  let top = 0;

  for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) {
    top += node.offsetTop;
  }

  return top;
};

/** The last anchor whose top has passed the top of the screen; null above the first one. */
export function scrollAnchorAt(y: number): ScrollAnchor | null {
  const anchors = document.querySelectorAll<HTMLElement>(SCROLL_ANCHORS);
  let found: ScrollAnchor | null = null;

  anchors.forEach((anchor, index) => {
    const top = layoutTop(anchor);

    if (anchor.offsetHeight > 0 && top <= y) {
      found = [index, y - top, anchors.length, y];
    }
  });

  return found;
}
