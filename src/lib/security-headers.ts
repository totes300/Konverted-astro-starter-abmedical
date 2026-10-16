// The headers every response carries, built once from config. Each origin and why it is listed:
// docs/features/security-headers.md

export type SecurityHeaderConfig = {
  siteUrl: string;
  sanityProjectId: string | undefined;
  isDev: boolean;
  /** Vercel injects its toolbar on preview deployments only. */
  isVercelPreview: boolean;
};

export type SecurityHeaders = {
  /** Sent on every route, the Studio included. */
  always: [string, string][];
  /** The Report-Only policy, for every route but the Studio. */
  reportOnly: string;
};

/** `'self'` plus the site's apex and `www` twin, so a Studio browsed on one previews pages served from the other. */
export function frameAncestors(siteUrl: string): string {
  const { protocol, host } = new URL(siteUrl);
  const apex = host.replace(/^www\./, "");

  return ["'self'", `${protocol}//${apex}`, `${protocol}//www.${apex}`].join(" ");
}

function serializePolicy(policy: Record<string, string[]>): string {
  return Object.entries(policy)
    .map(([directive, sources]) => [directive, ...new Set(sources)].join(" "))
    .join("; ");
}

export function reportOnlyPolicy({ sanityProjectId, isDev, isVercelPreview }: SecurityHeaderConfig): string {
  const sanityApi = sanityProjectId
    ? [
        `https://${sanityProjectId}.api.sanity.io`,
        `https://${sanityProjectId}.apicdn.sanity.io`,
        `wss://${sanityProjectId}.api.sanity.io`,
      ]
    : [];
  const toolbar = isVercelPreview ? ["https://vercel.live"] : [];

  return serializePolicy({
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", "https://cloud.umami.is", ...toolbar],
    "style-src": ["'self'", "'unsafe-inline'", ...toolbar],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      "https://cdn.sanity.io",
      "https://image.mux.com",
      ...(isVercelPreview ? ["https://vercel.live", "https://vercel.com"] : []),
    ],
    "font-src": ["'self'", "data:", ...(isVercelPreview ? ["https://vercel.live", "https://assets.vercel.com"] : [])],
    "media-src": ["'self'", "blob:", "https:"],
    "connect-src": [
      "'self'",
      "https://cloud.umami.is",
      "https://gateway.umami.is",
      "https://cdn.sanity.io",
      ...sanityApi,
      "https://api.sanity.io",
      "https://www.sanity.io",
      "https://stream.mux.com",
      "https://*.mux.com",
      "https://*.litix.io",
      "https://unpkg.com",
      "https://cdn.jsdelivr.net",
      ...(isVercelPreview ? ["https://vercel.live", "wss://ws-us3.pusher.com"] : []),
      ...(isDev ? ["ws:"] : []),
    ],
    "frame-src": ["'self'", ...toolbar],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  });
}

export function securityHeaders(config: SecurityHeaderConfig): SecurityHeaders {
  return {
    always: [
      ["X-Content-Type-Options", "nosniff"],
      ["Referrer-Policy", "strict-origin-when-cross-origin"],
      ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
      ["X-Frame-Options", "SAMEORIGIN"],
      ["Content-Security-Policy", `frame-ancestors ${frameAncestors(config.siteUrl)}`],
    ],
    reportOnly: reportOnlyPolicy(config),
  };
}
