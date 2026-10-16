import { prefersReducedMotion } from "~/lib/utils";

/** How far the focus layer fades in at the middle of the pass: a pull toward focus, never a hard snap to sharp. */
const MAX_FOCUS = 0.75;

/** Drift across the whole pass, small enough to read as depth rather than movement. */
const DRIFT_Y = 56;
const DRIFT_ROTATE = 3;

// Smoothstep, so the focus eases in and out of its peak instead of ramping linearly.
const ease = (t: number) => t * t * (3 - 2 * t);

// The scroll that carries the emblem from the bottom of the screen to past its top is measured once per layout;
// each scroll maps onto it: the sharper copy fades toward its peak at mid-screen while the pair drifts and turns.
export class EmblemElement extends HTMLElement {
  #focus: HTMLElement | null = null;
  #resizeObserver: ResizeObserver | null = null;
  #start = 0;
  #end = 0;

  #measure = () => {
    const rect = this.getBoundingClientRect();
    const top = rect.top + window.scrollY;

    this.#start = top - window.innerHeight;
    this.#end = top + rect.height;
    this.#onScroll();
  };

  #onScroll = () => {
    const progress = Math.min(Math.max((window.scrollY - this.#start) / Math.max(this.#end - this.#start, 1), 0), 1);
    const centred = 1 - Math.abs(progress * 2 - 1);
    const drift = 0.5 - progress;

    this.style.transform = `translate3d(0, ${drift * DRIFT_Y}px, 0) rotate(${-drift * DRIFT_ROTATE}deg)`;

    if (this.#focus) {
      this.#focus.style.opacity = String(ease(centred) * MAX_FOCUS);
    }
  };

  connectedCallback() {
    // Reduced motion keeps the soft emblem still, exactly as the design draws it.
    if (prefersReducedMotion()) {
      return;
    }

    this.#focus = this.querySelector<HTMLElement>("[data-emblem-focus]");

    // Content settling anywhere above (a late image, a font swap) moves the travel, not only a resize.
    this.#resizeObserver = new ResizeObserver(this.#measure);
    this.#resizeObserver.observe(document.documentElement);

    window.addEventListener("resize", this.#measure);
    window.addEventListener("scroll", this.#onScroll, { passive: true });
  }

  disconnectedCallback() {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    window.removeEventListener("resize", this.#measure);
    window.removeEventListener("scroll", this.#onScroll);
    this.#focus = null;
  }
}

if (!customElements.get("emblem-drift")) {
  customElements.define("emblem-drift", EmblemElement);
}
