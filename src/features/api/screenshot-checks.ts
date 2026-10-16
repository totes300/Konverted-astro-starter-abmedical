// Input and output checks for the Studio's SEO screenshot route (`src/pages/api/seo-screenshot.ts`).

import { siteHosts } from "~/lib/site-url";

const SCREENSHOT_ASSET_DOMAIN = "microlink.io";
const SCREENSHOT_CONTENT_TYPES: Record<string, "jpg" | "png"> = { "image/jpeg": "jpg", "image/png": "png" };
const MAX_TARGET_URL_LENGTH = 2048;

// The URL parser drops tab, CR and LF and reads a backslash as a slash, so refuse them raw.
function hasUnsafeUrlCharacter(value: string) {
  for (const character of value) {
    const code = character.charCodeAt(0);

    if (code < 0x20 || code === 0x7f || character === "\\") {
      return true;
    }
  }

  return false;
}

/** The page to capture, normalized, or `null` unless it is plain `https` on one of the site's own hosts. */
export function screenshotTargetUrl(value: unknown, siteUrl: string): URL | null {
  if (typeof value !== "string" || value.length > MAX_TARGET_URL_LENGTH || hasUnsafeUrlCharacter(value.trim())) {
    return null;
  }

  // A site served over plain http (local dev) is not one the provider can reach, so it accepts nothing.
  if (new URL(siteUrl).protocol !== "https:") {
    return null;
  }

  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  const isPlainHttps = url.protocol === "https:" && url.port === "" && url.username === "" && url.password === "";

  return isPlainHttps && siteHosts(siteUrl).includes(url.hostname) ? url : null;
}

/** True only for an `https` URL on the provider's asset domain, so a forged payload cannot point the fetch elsewhere. */
export function isScreenshotAssetUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    const host = url.hostname;
    const onAssetDomain = host === SCREENSHOT_ASSET_DOMAIN || host.endsWith(`.${SCREENSHOT_ASSET_DOMAIN}`);

    return url.protocol === "https:" && url.port === "" && url.username === "" && onAssetDomain;
  } catch {
    return false;
  }
}

/** File extension for an accepted screenshot `content-type`, or `null` for anything that is not a JPEG or PNG. */
export function screenshotExtension(contentType: string | null): "jpg" | "png" | null {
  const mediaType = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

  return SCREENSHOT_CONTENT_TYPES[mediaType] ?? null;
}

/** Reads at most `maxBytes`, or `null` when the body is larger, without buffering past the cap. */
export async function readCappedBody(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length") ?? 0);

  if (declared > maxBytes) {
    await response.body?.cancel();
    return null;
  }

  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    total += value.byteLength;

    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }

    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}
