// Cached Sanity reads for `src/middleware.ts` and the route cache, which answer before any page renders.
// Freshness, fail-stale and the content version tie: docs/features/basic-auth.md#the-gate-state

import { run } from "~/features/utils/common";

/** Per-instance hot cache TTL: the propagation ceiling when no content version says a publish happened. */
export const HOT_CACHE_TTL_MS = 5 * 60 * 1000;

/** How long past the TTL the last-known state may still be served while a single refresh round-trip runs. */
export const STALE_GRACE_MS = 60 * 1000;

/** Stale-if-error ceiling: past it a failing refresh rejects, so a gate cannot run on hour-old state forever. */
export const STALE_IF_ERROR_MS = 60 * 60 * 1000;

/** Pause after a failed refresh, so an outage or a 429 is retried once per window, not once per request. */
export const RETRY_BACKOFF_MS = 10 * 1000;

/** A hung fetch would wedge `inflight`, and with it every request past the TTL. */
const FETCH_TIMEOUT_MS = 5 * 1000;

/** Passed in by callers (from `~/lib/env`); `astro:env` cannot be imported here or the module stops being unit-testable. */
export type ProxySanityEnv = {
  projectId: string | undefined;
  dataset: string | undefined;
  apiVersion: string | undefined;
  token: string | undefined;
};

export type ProxyStateDeps = {
  /** The content version (`~/lib/content-version`): a value other than the held state's forces a blocking refetch. */
  version?: () => Promise<string>;
};

async function sanityFetchJson<T>(query: string, env: ProxySanityEnv): Promise<T> {
  const { projectId, dataset, apiVersion, token } = env;

  if (!projectId || !dataset || !apiVersion || !token) {
    throw new Error("Missing Sanity environment for middleware");
  }

  // The live API on purpose: apicdn invalidation is unreliable here, and the hot cache already caps request volume.
  const url = new URL(`https://${projectId}.api.sanity.io/v${apiVersion}/data/query/${dataset}`);
  url.searchParams.set("query", query);
  url.searchParams.set("perspective", "published");
  url.searchParams.set("returnQuery", "false");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Sanity middleware fetch failed: ${res.status}`);
  }

  const body = (await res.json()) as { result: T };
  return body.result;
}

/** A getter over a hot cache with bounded stale-while-revalidate, stale-if-error, a retry backoff and in-flight dedupe. */
export function createProxySanityState<TPayload, TState>(
  query: string,
  toState: (payload: TPayload) => TState,
  env: ProxySanityEnv,
  deps: ProxyStateDeps = {}
): () => Promise<TState> {
  let hot: { value: TState; fetchedAt: number; version: string | null; id: number } | null = null;
  let inflight: { promise: Promise<TState>; version: string | null } | null = null;
  let failure: { error: unknown; retryAt: number } | null = null;
  let lastId = 0;

  async function readVersion(): Promise<string | null> {
    if (!deps.version) {
      return null;
    }

    try {
      return await deps.version();
    } catch {
      return null;
    }
  }

  function refresh(version: string | null): Promise<TState> {
    // A fetch started under another version may predate the publish, so it is never joined.
    if (inflight && (version === null || inflight.version === version)) {
      return inflight.promise;
    }

    const id = ++lastId;
    const pending = run(async () => toState(await sanityFetchJson<TPayload>(query, env)));
    const current = { promise: pending, version };
    inflight = current;

    // Registered before any caller awaits, so `hot` is current by the time they resume.
    pending
      .then(
        (value) => {
          // A fetch that started before the held state's must not replace it, whichever settles last.
          if (!hot || id > hot.id) {
            hot = { value, fetchedAt: Date.now(), version, id };
            failure = null;
          }
        },
        (error: unknown) => {
          if (!hot || id > hot.id) {
            failure = { error, retryAt: Date.now() + RETRY_BACKOFF_MS };
          }

          console.error("proxy state: Sanity refresh failed", error);
        }
      )
      .finally(() => {
        if (inflight === current) {
          inflight = null;
        }
      });

    return pending;
  }

  function lastKnownOrThrow(error: unknown): TState {
    if (hot && Date.now() - hot.fetchedAt < STALE_IF_ERROR_MS) {
      return hot.value;
    }

    throw error;
  }

  return async function getState(): Promise<TState> {
    const version = await readVersion();
    const now = Date.now();
    const age = hot ? now - hot.fetchedAt : Number.POSITIVE_INFINITY;
    // An unreadable version falls back to the TTL; a different one means a publish since the held state was read.
    const isCurrent = version === null || hot?.version === version;

    if (hot && isCurrent && age < HOT_CACHE_TTL_MS) {
      return hot.value;
    }

    if (failure && now < failure.retryAt && !inflight) {
      return lastKnownOrThrow(failure.error);
    }

    const pending = refresh(version);

    // Bounded stale-while-revalidate on the TTL path only; after a publish the caller waits for the new state.
    if (hot && isCurrent && age < HOT_CACHE_TTL_MS + STALE_GRACE_MS) {
      return hot.value;
    }

    try {
      return await pending;
    } catch (error) {
      return lastKnownOrThrow(error);
    }
  };
}
