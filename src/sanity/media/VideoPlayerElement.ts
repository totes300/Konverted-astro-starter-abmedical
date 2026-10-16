import { reducedMotionQuery } from "~/lib/utils";

/** `auto` follows the page (on screen, tab shown, motion allowed); the other two are the reader's own call. */
type Intent = "auto" | "play" | "pause";

// The behaviour every video on the site shares, a native <video> or a Mux player alike. An autoplaying one plays only
// while it is on screen, the tab is shown and motion is allowed, and a reader's own play or pause outlasts all three.
export class VideoPlayerElement extends HTMLElement {
  #media: HTMLMediaElement | null = null;
  #observer: IntersectionObserver | null = null;
  #children: MutationObserver | null = null;
  #reducedMotion: MediaQueryList | null = null;
  #intent: Intent = "auto";
  #inView = false;

  /** Starts it for the reader, motion setting or not; it still rests while off screen and resumes on return. */
  play = () => {
    this.#intent = "play";
    this.#sync();
  };

  pause = () => {
    this.#intent = "pause";
    this.#sync();
  };

  toggle = () => {
    if (this.paused) {
      this.play();
    } else {
      this.pause();
    }
  };

  /** Paused as the reader sees it: a video resting off screen on its way to playing counts as playing. */
  get paused() {
    return !this.#shouldPlay();
  }

  #shouldPlay() {
    if (this.#intent === "pause" || !this.#inView || document.hidden) {
      return false;
    }

    return this.#intent === "play" || !this.#reducedMotion?.matches;
  }

  // A Mux player not yet upgraded has no `play`, and a property set on it now would shadow its own; it syncs once defined.
  #sync = () => {
    const media = this.#media;

    if (!media || typeof media.play !== "function") {
      return;
    }

    if (!this.#shouldPlay()) {
      media.pause();
      this.#reflect();
      return;
    }

    // A browser only starts a video unasked when it is silent.
    if (this.#intent === "auto") {
      media.muted = true;
    }

    void media.play()?.catch((error: unknown) => {
      // Refused outright (iOS Low Power Mode): it rests paused, so a toggle offers to play, which a tap is allowed to.
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        this.#intent = "pause";
      }

      this.#reflect();
    });

    this.#reflect();
  };

  // Every play and pause we make agrees with `#shouldPlay`, so one that does not came from the reader (native controls).
  #onPlay = () => {
    if (!this.#shouldPlay()) {
      this.#intent = "play";
    }

    this.#reflect();
  };

  // A reader's pause, or the end of a video that does not loop: either way it stays paused until asked again.
  #onPause = () => {
    if (this.#media?.ended || this.#shouldPlay()) {
      this.#intent = "pause";
    }

    this.#reflect();
  };

  #onIntersect = (entries: IntersectionObserverEntry[]) => {
    this.#inView = entries.some((entry) => entry.isIntersecting);
    this.#sync();
  };

  // With a toggle inside, a click on the video itself is the same toggle, for a pointer that cannot see the button.
  #onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;

    if (target?.closest("[data-video-toggle]") || (target === this.#media && this.querySelector("[data-video-toggle]"))) {
      this.toggle();
    }
  };

  // `data-playing` styles whatever sits inside; a toggle reads its label for the next action off its own data attributes.
  #reflect() {
    const playing = !this.paused;

    this.toggleAttribute("data-playing", playing);

    for (const button of this.querySelectorAll<HTMLElement>("[data-video-toggle]")) {
      const label = playing ? button.dataset.labelPause : button.dataset.labelPlay;

      if (label) {
        button.setAttribute("aria-label", label);
      }
    }
  }

  // Astro's router swaps the body in, connecting this, and only then replaces each parsed <video> with a fresh one.
  #onChildren = () => {
    if (this.#media && this.contains(this.#media)) {
      return;
    }

    this.#teardown();
    this.#setup();
  };

  #setup() {
    this.#media = this.querySelector<HTMLMediaElement>("video, mux-player");

    if (!this.#media) {
      return;
    }

    this.#intent = "auto";
    this.#media.addEventListener("play", this.#onPlay);
    this.#media.addEventListener("pause", this.#onPause);
    this.addEventListener("click", this.#onClick);

    // Served hidden, since a toggle does nothing until this runs.
    const toggles = this.querySelectorAll<HTMLElement>("[data-video-toggle]");

    for (const button of toggles) {
      button.hidden = false;
    }

    // The toggle is the keyboard's way in, so a player that is focusable itself (Mux's surface) leaves the tab order.
    if (toggles.length > 0 && !this.#media.hasAttribute("tabindex")) {
      this.#media.setAttribute("tabindex", "-1");
    }

    // Without autoplay the reader starts it, through its controls or a toggle; it is never started for them.
    if (!this.hasAttribute("data-autoplay")) {
      this.#intent = "pause";
      this.#inView = true;
      this.#reflect();
      return;
    }

    this.#reducedMotion = reducedMotionQuery();
    this.#reducedMotion.addEventListener("change", this.#sync);
    document.addEventListener("visibilitychange", this.#sync);

    this.#observer = new IntersectionObserver(this.#onIntersect);
    this.#observer.observe(this.#media);

    if (this.#media.localName === "mux-player") {
      void customElements.whenDefined("mux-player").then(this.#sync);
    }
  }

  #teardown() {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#reducedMotion?.removeEventListener("change", this.#sync);
    this.#reducedMotion = null;
    document.removeEventListener("visibilitychange", this.#sync);
    this.removeEventListener("click", this.#onClick);
    this.#media?.removeEventListener("play", this.#onPlay);
    this.#media?.removeEventListener("pause", this.#onPause);

    // Off the page it rests, whatever the reader last asked for.
    this.#media?.pause?.();
    this.#media = null;
    this.#inView = false;
  }

  connectedCallback() {
    this.#setup();
    this.#children = new MutationObserver(this.#onChildren);
    this.#children.observe(this, { childList: true });
  }

  disconnectedCallback() {
    this.#children?.disconnect();
    this.#children = null;
    this.#teardown();
  }
}

if (!customElements.get("video-player")) {
  customElements.define("video-player", VideoPlayerElement);
}
