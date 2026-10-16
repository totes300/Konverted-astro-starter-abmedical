import { parseLottieAssetDimensionsFromBuffer } from "../lib/parse-lottie-dimensions";
import { createAssetDimensionsInput } from "./asset-dimensions-input";

export const LottieFileInput = createAssetDimensionsInput({
  label: "Lottie",
  dimensionsFieldName: "lottieDimensions",
  parse: parseLottieAssetDimensionsFromBuffer,
  noDimensionsMessage:
    "Could not read width/height from Bodymovin JSON. Use a .json file for Generate, or enter dimensions manually for .lottie.",
});
