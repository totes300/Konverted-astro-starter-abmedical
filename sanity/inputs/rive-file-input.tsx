import { parseRiveAssetDimensionsFromBuffer } from "../lib/parse-rive-dimensions";
import { createAssetDimensionsInput } from "./asset-dimensions-input";

export const RiveFileInput = createAssetDimensionsInput({
  label: "Rive",
  dimensionsFieldName: "riveDimensions",
  parse: parseRiveAssetDimensionsFromBuffer,
  noDimensionsMessage: "Could not read width/height from this .riv file.",
});
