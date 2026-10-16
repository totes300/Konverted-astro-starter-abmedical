// Basic Auth primitives, shared by the middleware gate and by the route cache provider, which has to
// recognise already-authenticated traffic before the middleware runs.

import { createHash, timingSafeEqual as equalBytes } from "node:crypto";

export type BasicAuthCredentials = {
  username: string;
  password: string;
};

export function decodeBasicAuthHeader(header: string | null): BasicAuthCredentials | null {
  const match = /^Basic\s+(\S+)\s*$/i.exec(header ?? "");

  if (!match?.[1]) {
    return null;
  }

  try {
    const decoded = atob(match[1]);
    const colon = decoded.indexOf(":");

    if (colon === -1) {
      return null;
    }

    return {
      username: decoded.slice(0, colon),
      password: decoded.slice(colon + 1),
    };
  } catch {
    return null;
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time over fixed-length SHA-256 digests, so neither a matching prefix nor the secret's length shows. */
export function timingSafeEqual(a: string, b: string): boolean {
  return equalBytes(digest(a), digest(b));
}

/** The 401 that makes a browser ask for the username and password. */
export function basicAuthChallenge(): Response {
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Protected"' },
  });
}

/** True when the request's Basic header carries exactly these credentials; both halves are always compared. */
export function hasBasicCredentials(header: string | null, username: string, password: string): boolean {
  const creds = decodeBasicAuthHeader(header);

  if (!creds) {
    return false;
  }

  const usernameMatches = timingSafeEqual(creds.username, username);
  const passwordMatches = timingSafeEqual(creds.password, password);

  return usernameMatches && passwordMatches;
}

/** Null when unconfigured, or when the credentials fall outside latin1, which `btoa`/`atob` could not round-trip anyway. */
export function basicAuthorizationHeader(username: string, password: string): string | null {
  const user = username.trim();

  if (!user || !password) {
    return null;
  }

  try {
    return `Basic ${btoa(`${user}:${password}`)}`;
  } catch {
    return null;
  }
}
