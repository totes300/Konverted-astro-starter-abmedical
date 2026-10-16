import { Card, Flex, Grid, Stack, Text } from "@sanity/ui";
import { defineField, PatchEvent, type StringInputProps, set, unset } from "sanity";
import { BRAND_COLORS, findBrandColor, isHexColor, resolveColorSwatch } from "../../colors";

// Named swatches, never a free colour input: the token name is stored so the stylesheet owns the value.
function BrandColorInput({ onChange, value, elementProps }: StringInputProps) {
  const selected = findBrandColor(value);

  return (
    <Grid {...elementProps} gap={2} style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
      {BRAND_COLORS.map((color) => {
        const isSelected = color.name === selected?.name;
        // Clicking the selected swatch clears the field: the annotation stays, uncoloured.
        const toggle = () => onChange(PatchEvent.from(isSelected ? unset() : set(color.name)));

        return (
          <Card
            key={color.name}
            as="button"
            type="button"
            padding={2}
            radius={2}
            border
            pressed={isSelected}
            tone={isSelected ? "primary" : "default"}
            aria-pressed={isSelected}
            onClick={toggle}
            style={{ cursor: "pointer", textAlign: "left" }}
          >
            <Flex align="center" gap={3}>
              <div
                style={{
                  width: "28px",
                  height: "28px",
                  flexShrink: 0,
                  borderRadius: "3px",
                  background: color.swatch,
                  border: "1px solid rgba(128,128,128,0.4)",
                }}
              />
              <Stack gap={2}>
                <Text size={1} weight="medium">
                  {color.title}
                </Text>
                <Text size={0} muted>
                  {color.swatch}
                </Text>
              </Stack>
            </Flex>
          </Card>
        );
      })}
    </Grid>
  );
}

export const appColor = defineField({
  name: "appColor",
  title: "Color",
  description: "Pick one of the brand colors. Click the selected one to clear it.",
  type: "string",
  icon: () => <>🎨</>,
  components: {
    input: BrandColorInput,
  },
  validation: (R) => [
    R.custom((value) => {
      if (typeof value !== "string" || resolveColorSwatch(value)) {
        return true;
      }

      return `"${value}" is not a brand color. Pick one of: ${BRAND_COLORS.map(({ name }) => name).join(", ")}.`;
    }),
    R.custom((value) =>
      typeof value === "string" && isHexColor(value.trim())
        ? `${value.trim()} is a raw hex color. It still renders; pick a brand color so the stylesheet owns it.`
        : true
    ).warning(),
  ],
});
