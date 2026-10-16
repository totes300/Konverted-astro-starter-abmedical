// The route cache policy: what may be cached, gated vs public keying, and tag invalidation.
// Storage, credentials, the gate state and the content version are injected, so it runs and is tested the same everywhere.

import type { CacheOptions, CacheProvider } from "astro";
import { collectInvalidationTags, pathTag } from "astro/cache/provider-utils";
import { canonicalRequestPath, decodeRequestPath } from "~/features/auth/canonical-path";
import type { ContentVersion } from "./content-version";
import { entryKey, entryTtl, toEntry, toResponse } from "./entry";
import { isAuthenticatedRequest, shouldBypassCache } from "./rules";
import type { RouteCacheStore } from "./store";

/** On every entry, so clearing the cache runs through the same tag mechanism; it cannot collide with a `_type`, `doc:<id>` or uri tag. */
export const ROUTE_CACHE_ALL_TAG = "route-cache:all";

export type RouteCacheDeps = {
  store: RouteCacheStore;
  /** Read lazily per request, so env is resolved at runtime rather than module load. */
  getExpectedAuthorization: () => string | null;
  /** True only when the published Basic Auth state is known and leaves this canonical page path open to anyone. */
  isPublicPath: (path: string) => Promise<boolean>;
  /** `read` for the baseline, never newer than what the render's queries join; `readFresh` for the checks after. */
  contentVersion: Pick<ContentVersion, "read" | "readFresh">;
};

export function createRouteCacheProvider({
  store,
  getExpectedAuthorization,
  isPublicPath,
  contentVersion,
}: RouteCacheDeps): CacheProvider {
  // `setHeaders` runs against the same Request, so cache options reach the store write without a header detour.
  const pendingOptions = new WeakMap<Request, CacheOptions>();

  return {
    name: `route-cache:${store.name}`,
    invalidate: (options) => store.expireTag(collectInvalidationTags(options)),
    setHeaders(options, request) {
      pendingOptions.set(request, options);

      // Nothing cacheable leaves the app; see the header comment.
      return new Headers();
    },
    async onRequest(context, next) {
      const { request, url } = context;

      if (request.method !== "GET" || shouldBypassCache(request)) {
        return next();
      }

      // Different keys, so a gated render is never readable by a request that has not matched the credentials.
      const gated = isAuthenticatedRequest(request, getExpectedAuthorization());

      if (!gated && request.headers.has("authorization")) {
        return next();
      }

      const entryPath = decodeRequestPath(url.pathname);
      const gatePath = canonicalRequestPath(url.pathname);
      const keyed = entryKey(url);

      if (entryPath === null || gatePath === null || keyed === null) {
        return next();
      }

      // A hit answers before the middleware gate, so a public entry is only read or written while the state says public.
      const isServable = async () => gated || (await isPublicPath(gatePath).catch(() => false));
      const key = `${gated ? "gated" : "public"}:${keyed}`;
      const stored = await store.get(key).catch((error: unknown) => {
        console.error("route-cache: store read failed", error);

        return null;
      });

      if (stored) {
        if (!(await isServable())) {
          return next();
        }

        const hit = toResponse(stored);
        hit.headers.set("X-Astro-Cache", "HIT");

        return hit;
      }

      const renderedUnder = await contentVersion.read().catch(() => null);
      const versionNow = () => contentVersion.readFresh().catch(() => null);
      const response = await next();
      const options = pendingOptions.get(request);
      const ttl = entryTtl(response, options);

      if (ttl === null || renderedUnder === null || !(await isServable())) {
        return response;
      }

      const entry = await toEntry(response.clone());

      // A moved version means a publish landed mid-render, and its tag purge may already have run.
      if (entry && (await versionNow()) === renderedUnder) {
        await store
          .set(key, entry, { ttl, tags: [...(options?.tags ?? []), pathTag(entryPath), ROUTE_CACHE_ALL_TAG] })
          .catch((error: unknown) => {
            console.error("route-cache: store write failed", error);
          });

        // Not atomic with the check: a publish in between bumped before purging, so this read sees it.
        if ((await versionNow()) !== renderedUnder) {
          await store.delete(key).catch((error: unknown) => {
            console.error("route-cache: store delete failed", error);
          });
        }
      }

      response.headers.set("X-Astro-Cache", "MISS");

      return response;
    },
  };
}
