# Gestures, performance, accessibility

## Gesture and drag

### Momentum-based dismissal

Consider **velocity**, not only distance: `Math.abs(dragDistance) / elapsedTime`. Quick flick above ~0.11 can dismiss without hitting distance threshold.

### Damping at boundaries

Past the natural stop, **rubber-band** with damping instead of a hard wall.

### Pointer capture

After drag starts, **capture** pointer so tracking continues outside the element.

### Multi-touch

Ignore new touch points once a drag started to avoid jumps.

### Friction instead of hard stops

Allow overscroll with increasing friction rather than blocking abruptly.

## Performance rules

### Prefer `transform` and `opacity`

They stay on the compositor. Animating margin/padding/width/height triggers layout.

### CSS variables propagate

Updating a var on a parent can restyle many children. For drag offset, prefer **`transform` on the moving node** over a shared var every frame on a large subtree.

### Compositor-friendly properties

Per-frame JS that writes `left` / `top` / `width` runs on the main thread like `requestAnimationFrame` and stutters under load. For **maximum smoothness**, animate **`transform`** / **`translate`** and **`opacity`**, which the compositor can run on its own.

```js
element.animate([{ translate: "0 0" }, { translate: "100px 0" }], { duration: 300, easing: "ease-out" });
```

In demanding apps, **CSS animations** can stay smoother than JS-driven motion while the main thread loads assets. Use CSS for fixed choreography and the Web Animations API for dynamic, interruptible motion.

### Web Animations API

`element.animate(...)` gives programmatic control with performance closer to CSS.

## Accessibility

### `prefers-reduced-motion`

Reduce or remove **motion**; keep opacity/color that aid understanding.

```css
@media (prefers-reduced-motion: reduce) {
  .element {
    animation: fade 0.2s ease;
  }
}
```

In **this repo**, branch motion with the `prefers-reduced-motion` media query (CSS, or `prefersReducedMotion()` from `src/lib/utils.ts` in scripts).

### Touch devices and `:hover`

```css
@media (hover: hover) and (pointer: fine) {
  .element:hover {
    transform: scale(1.05);
  }
}
```

Avoid hover-only motion that fires incorrectly on touch after tap.
