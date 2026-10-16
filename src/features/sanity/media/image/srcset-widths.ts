// Never upscale, but an original between two steps is its own widest step, or a retina screen never gets it whole.
export function srcSetWidths(sourceWidths: number[], nativeWidth?: number | null): number[] {
  if (!nativeWidth) {
    return sourceWidths;
  }

  const widest = Math.min(nativeWidth, sourceWidths.at(-1) ?? nativeWidth);

  return [...sourceWidths.filter((sourceW) => sourceW < widest), widest];
}
