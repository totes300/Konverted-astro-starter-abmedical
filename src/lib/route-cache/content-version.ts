// Rides on every published query as an unused GROQ parameter. Sanity's CDN keys on the full URL, so a
// value it has never seen is a guaranteed miss: freshness is this value, never the CDN's own invalidation.

export const CONTENT_VERSION_PARAM = "contentVersion";

/** What a fresh store answers before the first publish has ever bumped it. */
export const INITIAL_CONTENT_VERSION = "0";

export type ContentVersionStore = {
  get(): Promise<string | null>;
  set(version: string): Promise<void>;
};

export type ContentVersion = {
  read(): Promise<string>;
  /** Never joins a read already in flight, which may have started before a bump. */
  readFresh(): Promise<string>;
  /** Rejects when the store does not hand the new value back, so the caller can fail and be retried. */
  bump(): Promise<string>;
};

/** Per process, like the in-memory route cache: a bump only reaches the instance that received it. */
export function createMemoryVersionStore(): ContentVersionStore {
  let version: string | null = null;

  return {
    get: async () => version,
    set: async (next) => {
      version = next;
    },
  };
}

/** Sortable by time so a value is legible in logs; the suffix separates publishes within one tick. */
export function nextContentVersion(now = Date.now()): string {
  return `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Deduped while in flight, never memoized: only a read already in flight at a bump can answer the version before it. */
export function createContentVersion(store: ContentVersionStore): ContentVersion {
  let pending: Promise<string> | null = null;

  async function readFresh(): Promise<string> {
    return (await store.get()) ?? INITIAL_CONTENT_VERSION;
  }

  async function readOnce(): Promise<string> {
    try {
      return await readFresh();
    } finally {
      pending = null;
    }
  }

  return {
    read() {
      if (!pending) {
        pending = readOnce();
      }

      return pending;
    },
    readFresh,
    async bump() {
      const version = nextContentVersion();

      await store.set(version);

      // A store may swallow its own failed write; only reading the value back catches a lost bump.
      if ((await readFresh()) !== version) {
        throw new Error("content version: the store did not keep the bump");
      }

      return version;
    },
  };
}
