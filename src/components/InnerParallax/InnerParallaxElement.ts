import { prefersReducedMotion } from "~/lib/utils";

// The inner box is oversized by `--parallax-overflow` on the active axis and slides across that slack as the
// window scrolls past: the scroll position is mapped over the element's travel, which is measured once per layout.
export class InnerParallaxElement extends HTMLElement {
  #inner: HTMLElement | null = null;
  #resizeObserver: ResizeObserver | null = null;
  #start = 0;
  #end = 0;
  #overflow = 0;
  #sideways = false;

  // The scroll that carries the element from the bottom of the screen to past its top.
  #pageTravel = (): [number, number] => {
    const rect = this.getBoundingClientRect();
    const top = rect.top + window.scrollY;

    return [top - window.innerHeight, top + rect.height];
  };

  // A pinned `HorizontalScroll` row moves 1px sideways per 1px scrolled, so the travel is the scroll that carries it across.
  #rowTravel = (): [number, number] | null => {
    const row = this.closest<HTMLElement>("horizontal-scroll");
    const viewport = row?.querySelector<HTMLElement>("[data-horizontal-viewport]");
    const track = row?.querySelector<HTMLElement>("[data-horizontal-track]");

    if (!row || !viewport || !track || getComputedStyle(viewport).position !== "sticky") {
      return null;
    }

    const rect = this.getBoundingClientRect();
    const rowTop = row.getBoundingClientRect().top + window.scrollY;
    const offset = rect.left - track.getBoundingClientRect().left + viewport.getBoundingClientRect().left;

    return [rowTop + offset - window.innerWidth, rowTop + offset + rect.width];
  };

  #measure = () => {
    const style = getComputedStyle(this);

    this.#overflow = Math.abs(Number.parseFloat(style.getPropertyValue("--parallax-overflow"))) || 0;
    this.#sideways = style.getPropertyValue("--parallax-x").trim() === "1";
    [this.#start, this.#end] = this.#rowTravel() ?? this.#pageTravel();
    this.#onScroll();
  };

  #onScroll = () => {
    if (!this.#inner) {
      return;
    }

    const progress = Math.min(Math.max((window.scrollY - this.#start) / Math.max(this.#end - this.#start, 1), 0), 1);
    const offset = (progress * 2 - 1) * this.#overflow;

    this.#inner.style.transform = this.#sideways ? `translate3d(${offset}px, 0, 0)` : `translate3d(0, ${offset}px, 0)`;
  };

  connectedCallback() {
    // Reduced motion keeps the media centered in its window (no scroll-linked movement).
    if (prefersReducedMotion()) {
      return;
    }

    this.#inner = this.querySelector<HTMLElement>("[data-parallax-inner]");

    if (!this.#inner) {
      return;
    }

    // Content settling anywhere above (a late image, a font swap, a row resizing) moves the travel, not only a resize.
    this.#resizeObserver = new ResizeObserver(this.#measure);
    this.#resizeObserver.observe(document.documentElement);
    this.#resizeObserver.observe(this);

    window.addEventListener("resize", this.#measure);
    window.addEventListener("scroll", this.#onScroll, { passive: true });
  }

  disconnectedCallback() {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    window.removeEventListener("resize", this.#measure);
    window.removeEventListener("scroll", this.#onScroll);
    this.#inner = null;
  }
}

if (!customElements.get("inner-parallax")) {
  customElements.define("inner-parallax", InnerParallaxElement);
}
