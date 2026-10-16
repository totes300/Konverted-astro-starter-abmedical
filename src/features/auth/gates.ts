// The two Basic Auth gates `src/middleware.ts` runs. Both stay open under `astro dev`: Chrome drops URL
// credentials from subresources, so a localhost 401 would 401 all client JS. Builds set IS_DEV false.

import type { APIContext, MiddlewareNext } from "astro";
import { type BasicAuthCredentials, basicAuthChallenge, hasBasicCredentials } from "~/features/auth/basic-auth";
import { isProtectedPath } from "~/features/auth/basic-auth-state";
import { type BasicAuthState, getSanityBasicAuthState } from "~/features/auth/sanity-basic-auth-proxy";
import { RETRY_BACKOFF_MS } from "~/features/sanity/proxy-state";
import { IS_DEV } from "~/features/utils/constants";
import { BASIC_AUTH_PASSWORD, BASIC_AUTH_USERNAME } from "~/lib/env";

/** The one username and password every gate checks against; null when the deployment has not set them. */
export function basicAuthCredentials(): BasicAuthCredentials | null {
  const username = BASIC_AUTH_USERNAME?.trim() ?? "";
  const password = BASIC_AUTH_PASSWORD ?? "";

  return username && password ? { username, password } : null;
}

function hasValidHeader(context: APIContext, credentials: BasicAuthCredentials) {
  return hasBasicCredentials(context.request.headers.get("authorization"), credentials.username, credentials.password);
}

/** For authoring tooling: gated on every deployment whatever the CMS says, and closed when unconfigured. */
export function gateAlways(context: APIContext, next: MiddlewareNext, name: string): Response | Promise<Response> {
  if (IS_DEV) {
    return next();
  }

  const credentials = basicAuthCredentials();

  if (!credentials) {
    return new Response(
      `${name} is always behind Basic Auth, but BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD are not set in the deployment environment.`,
      { status: 503 }
    );
  }

  return hasValidHeader(context, credentials) ? next() : basicAuthChallenge();
}

/** Without any state the gate cannot tell a locked page from an open one, so it refuses rather than serving. */
function stateUnavailableResponse(): Response {
  return new Response("The site's access settings could not be read. Try again in a moment.", {
    status: 503,
    headers: { "Retry-After": String(RETRY_BACKOFF_MS / 1000), "Cache-Control": "no-store" },
  });
}

/** The CMS-managed gate for a canonical page path: site-wide or per-page Basic Auth, as the published settings say. */
export async function gateByCms(context: APIContext, next: MiddlewareNext, pathname: string): Promise<Response> {
  if (IS_DEV) {
    return next();
  }

  // Unconfigured means no auth can run, but Sanity is still read below for the 503 explaining it.
  const credentials = basicAuthCredentials();

  // A valid header covers almost all logged-in traffic, since browsers resend it, so skip the Sanity read.
  if (credentials && hasValidHeader(context, credentials)) {
    return next();
  }

  let state: BasicAuthState;

  try {
    state = await getSanityBasicAuthState();
  } catch (error) {
    // A cold instance, or one whose last state is over an hour old; see docs/features/basic-auth.md.
    console.error("middleware: Basic Auth state unavailable, refusing the request", error);

    return stateUnavailableResponse();
  }

  if (!isProtectedPath(state, pathname)) {
    return next();
  }

  if (!credentials) {
    return new Response(
      "Basic Auth is enabled in the CMS but BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD are not set in the deployment environment.",
      { status: 503 }
    );
  }

  return basicAuthChallenge();
}
