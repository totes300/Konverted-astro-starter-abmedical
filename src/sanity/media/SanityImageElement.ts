// Clears the placeholder `SanityImage` paints once the image loads, so it never shows around it.
export class SanityImageElement extends HTMLElement {
  #image: HTMLImageElement | null = null;

  #clear = () => {
    this.#image?.style.removeProperty("background-image");
    this.#image?.style.removeProperty("background-size");
    this.#image?.style.removeProperty("background-position");
  };

  connectedCallback() {
    this.#image = this.querySelector("img");

    if (!this.#image) {
      return;
    }

    // An image that finished before this element upgraded never fires `load` for it.
    if (this.#image.complete && this.#image.naturalWidth > 0) {
      this.#clear();
      return;
    }

    this.#image.addEventListener("load", this.#clear, { once: true });
  }

  disconnectedCallback() {
    this.#image?.removeEventListener("load", this.#clear);
    this.#image = null;
  }
}

if (!customElements.get("sanity-image")) {
  customElements.define("sanity-image", SanityImageElement);
}
