import type { APIRoute } from "astro";
import { authorizeStudioRequest } from "~/features/api/auth";
import { apiErrorResponse, internalErrorResponse, privateJson } from "~/features/api/errors";
import { isScreenshotAssetUrl, readCappedBody, screenshotExtension, screenshotTargetUrl } from "~/features/api/screenshot-checks";
import { PUBLIC_SITE_URL } from "~/lib/env";
import { siteHosts } from "~/lib/site-url";
import { sanityEditClient as sanityWriteClient } from "../../sanity/lib/client";

// Studio-triggered SEO screenshot capture: Microlink screenshot fetch, uploaded to Sanity as an
// image asset.
export const prerender = false;

const VIEWPORT_WIDTH = 1920;
const VIEWPORT_HEIGHT = 1008;
const JPEG_QUALITY = 85;
const DEFAULT_WAIT_SECONDS = 2;
const MAX_WAIT_SECONDS = 10;
// Under the adapter's 60 s maxDuration, so a slow step still answers with JSON rather than the host's 504 page.
const DEADLINE_MS = 55_000;
// Microlink and the download stop by 45 s, leaving the rest of the deadline to the upload.
const MICROLINK_TIMEOUT_MS = 35_000;
const ASSET_TIMEOUT_MS = 10_000;
const MIN_UPLOAD_TIMEOUT_MS = 1_000;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

type MicrolinkResponse = {
  status?: string;
  data?: {
    screenshot?: {
      url?: string;
      type?: string;
      width?: number;
      height?: number;
    };
  };
  message?: string;
};

function upstreamError(error: string, hint?: string) {
  return apiErrorResponse(502, { error, code: "upstream_failed", hint });
}

export const POST: APIRoute = async ({ request }) => {
  const deadline = Date.now() + DEADLINE_MS;
  const denied = await authorizeStudioRequest(request);

  if (denied) {
    return denied;
  }

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    if (typeof body?.url !== "string" || !body.url.trim()) {
      return apiErrorResponse(400, { error: "Missing url.", code: "missing_url" });
    }

    const targetUrl = screenshotTargetUrl(body.url, PUBLIC_SITE_URL);

    if (!targetUrl) {
      return apiErrorResponse(400, {
        error: `The Source URL must be an https page on this site (${siteHosts(PUBLIC_SITE_URL).join(" or ")}).`,
        code: "url_not_allowed",
      });
    }

    const rawWait =
      typeof body.waitSeconds === "number" && Number.isFinite(body.waitSeconds) ? body.waitSeconds : DEFAULT_WAIT_SECONDS;
    const waitSeconds = Math.max(0, Math.min(MAX_WAIT_SECONDS, rawWait));
    const waitMs = Math.round(waitSeconds * 1000);

    const params = new URLSearchParams({
      url: targetUrl.href,
      screenshot: "true",
      meta: "false",
      "viewport.width": String(VIEWPORT_WIDTH),
      "viewport.height": String(VIEWPORT_HEIGHT),
      "viewport.deviceScaleFactor": "1",
      "screenshot.type": "jpeg",
      "screenshot.quality": String(JPEG_QUALITY),
      "screenshot.fullPage": "false",
      waitUntil: "networkidle0",
      waitForTimeout: String(waitMs),
    });

    const microlinkRes = await fetch(`https://api.microlink.io/?${params.toString()}`, {
      signal: AbortSignal.timeout(MICROLINK_TIMEOUT_MS),
    });
    const payload = (await microlinkRes.json().catch(() => null)) as MicrolinkResponse | null;

    if (microlinkRes.status === 429) {
      return upstreamError("Microlink's rate limit was reached.", "Try again later.");
    }

    if (!microlinkRes.ok || payload?.status !== "success") {
      console.error("Microlink request failed", microlinkRes.status, payload?.message);
      return upstreamError("Microlink could not capture this page.", "Check that the page is live, then try again.");
    }

    const screenshotUrl = payload.data?.screenshot?.url;

    if (!isScreenshotAssetUrl(screenshotUrl)) {
      console.error("Microlink returned an unexpected screenshot url", screenshotUrl);
      return upstreamError("Microlink returned no usable screenshot.");
    }

    // A redirect could leave the allowlisted host before any check on the response runs.
    const imageRes = await fetch(screenshotUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(ASSET_TIMEOUT_MS),
    });

    if (!imageRes.ok || !isScreenshotAssetUrl(imageRes.url || screenshotUrl)) {
      console.error("Screenshot asset fetch failed", imageRes.status, imageRes.url);
      await imageRes.body?.cancel();
      return upstreamError("Could not download the screenshot.");
    }

    const contentType = imageRes.headers.get("content-type");
    const extension = screenshotExtension(contentType);

    if (!extension) {
      console.error("Screenshot asset has an unexpected content type", contentType);
      await imageRes.body?.cancel();
      return upstreamError("Microlink returned a file that is not a JPEG or PNG image.");
    }

    const bytes = await readCappedBody(imageRes, MAX_SCREENSHOT_BYTES);

    if (!bytes || bytes.byteLength === 0) {
      return upstreamError("The screenshot was empty or too large.");
    }

    const hostname = targetUrl.hostname.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
    const filename = `share-${hostname || "screenshot"}-${Date.now()}.${extension}`;

    // Uploads have no timeout unless one is passed; this one ends with the deadline.
    const asset = await sanityWriteClient.assets.upload("image", Buffer.from(bytes), {
      filename,
      contentType: extension === "jpg" ? "image/jpeg" : "image/png",
      timeout: Math.max(MIN_UPLOAD_TIMEOUT_MS, deadline - Date.now()),
    });

    return privateJson({
      image: {
        _type: "image",
        asset: {
          _type: "reference",
          _ref: asset._id,
        },
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return internalErrorResponse(
        error,
        { error: "The screenshot took too long.", code: "upstream_timeout", hint: "Try again in a moment." },
        504
      );
    }

    return internalErrorResponse(error, {
      error: "Screenshot generation failed.",
      code: "internal_error",
      hint: "Try again in a moment.",
    });
  }
};
