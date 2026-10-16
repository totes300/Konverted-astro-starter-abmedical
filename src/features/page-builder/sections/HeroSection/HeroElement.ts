import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { SplitText } from "gsap/SplitText";

import { REVEAL_CURVE } from "~/lib/curves";
import { skipIntro, whenIntroReady } from "~/lib/intro";

gsap.registerPlugin(SplitText, CustomEase);

/** The site's shared reveal curve, so the hero lands like every other entrance. */
const REVEAL_EASE = CustomEase.create("hero-reveal", REVEAL_CURVE.replaceAll(" ", ""));

/** Hairlines draw on a symmetric curve: they travel, rather than arrive. */
const DRAW_EASE = "power3.inOut";

/** Room under each masked line, so a 1.1 leading does not clip descenders while it rises. */
const MASK_REACH = "0.14em";

/**
 * The hero's page-load intro: the hairline grid draws in, then the headline rises line by line out of its
 * masks and the CTA follows. Markup ships hidden behind `data-intro`; every path off it lands on the full state.
 */
export class HeroElement extends HTMLElement {
  #timeline: gsap.core.Timeline | null = null;
  #split: SplitText | null = null;
  #cancelled = false;

  connectedCallback() {
    this.#cancelled = false;

    if (skipIntro()) {
      this.removeAttribute("data-intro");
      return;
    }

    void this.#play();
  }

  disconnectedCallback() {
    this.#cancelled = true;
    this.#timeline?.kill();
    this.#timeline = null;
    this.#split?.revert();
    this.#split = null;
  }

  #play = async () => {
    // The markup sets `data-viewport-disabled`: the hero opens the page, so only fonts and the page transition gate it.
    await whenIntroReady(this).ready;

    const headline = this.querySelector<HTMLElement>("[data-hero-headline]");

    if (this.#cancelled || !headline) {
      this.removeAttribute("data-intro");
      return;
    }

    const linesX = Array.from(this.querySelectorAll<HTMLElement>('[data-hero-line="x"]'));
    const linesY = Array.from(this.querySelectorAll<HTMLElement>('[data-hero-line="y"]'));
    const ctaMask = this.querySelector<HTMLElement>("[data-hero-cta-mask]");
    const cta = this.querySelector<HTMLElement>("[data-hero-cta]");

    this.#split = SplitText.create(headline, { type: "lines", mask: "lines" });

    gsap.set(this.#split.masks, { paddingBottom: MASK_REACH, marginBottom: `-${MASK_REACH}` });
    // Both axes stated: GSAP folds the CSS pre-hide's `scale: 0` into its cache, so the untouched axis would stay at 0.
    gsap.set(linesX, { scaleX: 0, scaleY: 1 });
    gsap.set(linesY, { scaleX: 1, scaleY: 0 });
    gsap.set(this.#split.lines, { yPercent: 110 });

    if (cta) {
      gsap.set(cta, { yPercent: 110 });
    }

    // The from-states now hold the copy and the rules out of sight, so the CSS pre-hide can go.
    this.removeAttribute("data-intro");

    this.#timeline = gsap
      .timeline({ onComplete: this.#settle })
      .to(linesX, { scaleX: 1, duration: 1.4, ease: DRAW_EASE, stagger: 0.12 }, 0)
      .to(linesY, { scaleY: 1, duration: 1.1, ease: DRAW_EASE }, 0.45)
      .to(this.#split.lines, { yPercent: 0, duration: 1.2, ease: REVEAL_EASE, stagger: 0.12 }, 0.5);

    if (cta) {
      this.#timeline.to(cta, { yPercent: 0, duration: 1, ease: REVEAL_EASE }, 0.85);
    }

    // The mask would clip the button's focus ring and hover nudge once it has risen.
    if (ctaMask) {
      this.#timeline.set(ctaMask, { overflow: "visible" });
    }
  };

  /** Hands the headline back as plain text: no line wrappers left to break on a later resize. */
  #settle = () => {
    this.#split?.revert();
    this.#split = null;
  };
}

if (!customElements.get("hero-intro")) {
  customElements.define("hero-intro", HeroElement);
}
