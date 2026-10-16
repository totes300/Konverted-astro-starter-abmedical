import { splitText, type TextSplit } from "kugiri";

import { skipSplit } from "~/lib/intro";

/** The read opens as the statement's middle comes 90% down the screen and is spent at the middle of it. */
const READ_START = 0.9;

const READ_END = 0.5;

const RESIZE_SETTLE_MS = 200;

/** One string per word, recomputed from `--reading-progress`, so a frame costs one property write on the host. */
const WORD_OPACITY = `calc(
  var(--reading-unread) + (1 - var(--reading-unread)) * clamp(0, (var(--reading-progress, 0)
  - (var(--word) + var(--reading-offset, 0))
  * ((var(--reading-span) - var(--reading-fade)) / max(1, var(--reading-words) - 1)))
  / var(--reading-fade), 1))`;

export const SPLIT_MEASURE = "reading-text:split";

/** Every connected statement, so one resize restages all of them on one clock. */
const hosts = new Set<ReadingTextElement>();

let settle = 0;
let wired = false;
let splitWidth = 0;

// Dropped on the first resize, not debounced in place: a split bakes each word's width and the type is fluid.
function restage() {
  for (const host of hosts) {
    host.unsplit();
  }

  clearTimeout(settle);

  settle = window.setTimeout(() => {
    for (const host of hosts) {
      host.resplit();
    }
  }, RESIZE_SETTLE_MS);
}

// Width only: iOS resizes the window as its toolbar collapses mid-scroll, and a height change moves no line break.
function onResize() {
  if (window.innerWidth === splitWidth) {
    return;
  }

  splitWidth = window.innerWidth;
  restage();
}

function watch(host: ReadingTextElement) {
  if (!wired) {
    wired = true;
    splitWidth = window.innerWidth;
    // Not a ResizeObserver: a word-level split holds its own box open, so the width it reports never moves.
    window.addEventListener("resize", onResize, { passive: true });
    document.fonts.addEventListener("loadingdone", restage);
  }

  hosts.add(host);
}

/** The read is one number, `--reading-progress`; the inline styles the markup ships work it out from there. */
export class ReadingTextElement extends HTMLElement {
  #text: HTMLElement | null = null;
  #splits: TextSplit[] = [];
  #resizeObserver: ResizeObserver | null = null;
  #start = 0;
  #end = 0;
  #ramp = "";
  #progress = 0;
  #cancelled = false;

  connectedCallback() {
    this.#cancelled = false;
    this.#text = this.querySelector<HTMLElement>("[data-reading-text]");

    if (!this.#text) {
      return;
    }

    this.#ramp = this.#text.style.opacity;

    // The visual editor and reduced motion get the finished state, not the grey the markup ships.
    if (skipSplit()) {
      this.progress = 1;
      return;
    }

    if (!this.hasAttribute("data-driven")) {
      this.#drive();
    }

    // Line boxes only settle once the face the copy is read in has loaded.
    void document.fonts.ready.then(() => {
      if (this.#cancelled) {
        return;
      }

      this.#split();
      watch(this);
    });
  }

  disconnectedCallback() {
    this.#cancelled = true;
    hosts.delete(this);
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    window.removeEventListener("resize", this.#measure);
    window.removeEventListener("scroll", this.#read);
    this.unsplit();
    this.style.removeProperty("--reading-progress");
    this.style.removeProperty("--reading-words");
    this.#text = null;
  }

  /** How far the read has come, 0 to 1. A driven host maps its own scroll window onto it. */
  get progress() {
    return this.#progress;
  }

  set progress(value: number) {
    this.#progress = Math.min(1, Math.max(0, value));
    this.style.setProperty("--reading-progress", String(this.#progress));
  }

  unsplit = () => {
    for (const split of this.#splits) {
      split.revert();
    }

    this.#splits = [];

    // The words carried the read; with them gone the copy takes it back as one piece.
    if (this.#text) {
      this.#text.style.opacity = this.#ramp;
    }
  };

  resplit = () => {
    if (this.#splits.length === 0 && !this.#cancelled) {
      this.#split();
    }
  };

  // The window is measured once per layout and the scroll mapped over it, so a scroll frame reads no layout.
  #measure = () => {
    const rect = this.getBoundingClientRect();
    const center = rect.top + window.scrollY + rect.height / 2;
    // Clamped, so a statement in the last screen is not asked to end past the page's own end.
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

    this.#start = center - window.innerHeight * READ_START;
    this.#end = Math.min(Math.max(center - window.innerHeight * READ_END, 0), maxScroll);
    this.#read();
  };

  // Through the setter, so a parent and the element itself drive the read the same way.
  #read = () => {
    this.progress = (window.scrollY - this.#start) / Math.max(this.#end - this.#start, 1);
  };

  #drive() {
    // Content settling anywhere above (a late image, a font swap) moves the window, not only a resize.
    this.#resizeObserver = new ResizeObserver(this.#measure);
    this.#resizeObserver.observe(document.documentElement);

    window.addEventListener("resize", this.#measure);
    window.addEventListener("scroll", this.#read, { passive: true });
  }

  // kugiri restarts --word at zero in each block, so a block is told what ran before it.
  #split() {
    const text = this.#text;

    if (!text) {
      return;
    }

    const selector = this.getAttribute("data-split-selector");
    const matches = selector ? Array.from(text.querySelectorAll<HTMLElement>(selector)) : [];
    const targets = matches.length > 0 ? matches : [text];
    const start = performance.now();

    this.#splits = targets.map((target) => splitText(target, { type: ["words"] }));

    let before = 0;

    for (const [index, split] of this.#splits.entries()) {
      targets[index]?.style.setProperty("--reading-offset", String(before));
      before += split.words.length;

      for (const word of split.words) {
        word.style.opacity = WORD_OPACITY;
      }
    }

    this.style.setProperty("--reading-words", String(before));
    text.style.removeProperty("opacity");

    performance.measure(SPLIT_MEASURE, { start, detail: { words: before } });
  }
}

if (!customElements.get("reading-text")) {
  customElements.define("reading-text", ReadingTextElement);
}
