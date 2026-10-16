// Astro re-renders a throw on its `/500` route, a page route here, so the gate would answer it as a page:
// a Basic challenge from an endpoint on a locked site. An exempt route's throw is answered here instead.

/** A fixed 503 with a body (Astro reroutes a body-less 404 or 500 to its error page) and `no-store`, so no cache keeps it. */
export async function runExemptRoute(next: () => Promise<Response>): Promise<Response> {
  try {
    return await next();
  } catch (error) {
    console.error("[middleware] an exempt route threw:", error);

    return new Response("Service Unavailable", {
      status: 503,
      headers: { "Cache-Control": "private, no-store", "Retry-After": "10" },
    });
  }
}
