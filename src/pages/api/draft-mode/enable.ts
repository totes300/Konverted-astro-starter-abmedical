import { validatePreviewUrl } from "@sanity/preview-url-secret";
import { perspectiveCookieName, urlSearchParamPreviewSecret } from "@sanity/preview-url-secret/constants";
import type { APIRoute } from "astro";
import { apiErrorResponse } from "~/features/api/errors";
import { isExactRoutePath } from "~/features/api/exact-path";
import {
  createDraftSession,
  DRAFT_SESSION_COOKIE,
  DRAFT_SESSION_MAX_AGE_SECONDS,
  hasPreviewSecretShape,
  safeRedirectPath,
} from "~/features/auth/draft-session";
import { previewCheckFailed } from "~/features/auth/preview-check";
import { SANITY_API_VIEW_TOKEN } from "~/lib/env";
import { sanityClient } from "../../../sanity/lib/client";

// Presentation-tool handshake: verify the signed secret, set the cookie that flips loadQuery into
// draft mode.
export const prerender = false;

export const GET: APIRoute = async ({ request, routePattern, cookies, redirect }) => {
  const token = SANITY_API_VIEW_TOKEN;
  if (!token) {
    return apiErrorResponse(500, {
      error: "SANITY_API_VIEW_TOKEN is required for live preview.",
      code: "missing_view_token",
      hint: "Set SANITY_API_VIEW_TOKEN in the deployment environment.",
    });
  }

  const url = new URL(request.url);
  const invalidSecret = () =>
    apiErrorResponse(401, {
      error: "Invalid preview secret.",
      code: "invalid_preview_secret",
      hint: "Open preview from the Studio's Presentation tool so the URL carries a fresh signed secret.",
    });

  // Astro routes other spellings here too; refusing them keeps every Sanity read on a path the firewall rule counts.
  if (!isExactRoutePath(request.url, routePattern)) {
    return invalidSecret();
  }

  // Same answer as a wrong secret, without spending a Sanity read on a value the Studio never generates.
  if (!hasPreviewSecretShape(url.searchParams.get(urlSearchParamPreviewSecret))) {
    return invalidSecret();
  }

  let verdict: Awaited<ReturnType<typeof validatePreviewUrl>>;

  try {
    // useCdn false: the secret was written moments ago; a CDN-stale read would fail the handshake.
    verdict = await validatePreviewUrl(sanityClient.withConfig({ token, useCdn: false }), request.url);
  } catch (error) {
    return previewCheckFailed(error);
  }

  const { isValid, redirectTo, studioPreviewPerspective } = verdict;

  if (!isValid) {
    return invalidSecret();
  }

  // First-party iframe, so SameSite=Lax; not httpOnly, because the overlay rewrites it on a perspective switch.
  cookies.set(perspectiveCookieName, studioPreviewPerspective ?? "drafts", {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
  });

  // The proof the middleware trusts: the perspective cookie above is readable and settable by any client.
  cookies.set(DRAFT_SESSION_COOKIE, await createDraftSession(token), {
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: "/",
    maxAge: DRAFT_SESSION_MAX_AGE_SECONDS,
  });

  // The preview pathname is normalized by a URL parser, so `/.//host` arrives as `//host`; Astro would emit it verbatim.
  return redirect(safeRedirectPath(redirectTo, url.origin), 307);
};
