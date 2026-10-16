import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { inspect } from "node:util";
import { authorizeStudioRequest, grantsPublish } from "./studio-auth";

const CONFIG = { projectId: "testproj", apiVersion: "2099-01-31" };
const realFetch = globalThis.fetch;
let sanityCalls: string[] = [];

type Session = {
  /** `/users/me`: status and body. */
  me: { status: number; body?: unknown };
  /** Access API `user-permissions/me`: status and pages of permissions. */
  permissions: { status: number; pages?: unknown[][] };
};

const publishPermission = {
  type: "sanity.document.filter.mode",
  name: "sanity-all-documents",
  action: "mode",
  params: { mode: "publish" },
};
const readPermission = {
  type: "sanity.document.filter.mode",
  name: "sanity-all-documents",
  action: "mode",
  params: { mode: "read" },
};
const draftsOnlyPermission = {
  type: "sanity.document.filter.mode",
  name: "sanity-all-documents",
  action: "mode",
  params: { mode: "create" },
};
const projectReadPermission = { type: "sanity.project", name: "sanity-project", action: "read" };

const person = (...permissions: unknown[]): Session => ({
  me: { status: 200, body: { id: "g-person", provider: "google" } },
  permissions: { status: 200, pages: [permissions] },
});

/** Stands in for Sanity: routes each request by endpoint, then by the token it carries. */
function mockSanity(byToken: Record<string, Session | "network-error">) {
  sanityCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    sanityCalls.push(url.toString());
    const token = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "") ?? "";
    const session = byToken[token];

    if (session === "network-error") {
      throw new TypeError("fetch failed");
    }

    const unauthorized = Response.json(
      { statusCode: 401, error: "Unauthorized", message: "A valid session is required" },
      { status: 401 }
    );

    if (!session) {
      return unauthorized;
    }

    if (url.pathname.endsWith("/users/me")) {
      return Response.json(session.me.body ?? {}, { status: session.me.status });
    }

    if (url.pathname.endsWith("/user-permissions/me")) {
      const pages = session.permissions.pages ?? [[]];
      const index = Number(url.searchParams.get("nextCursor") ?? 0);
      const nextCursor = index + 1 < pages.length ? String(index + 1) : null;
      return Response.json({ data: pages[index] ?? [], nextCursor }, { status: session.permissions.status });
    }

    return new Response("unexpected endpoint", { status: 500 });
  }) as typeof fetch;
}

function request(headers: Record<string, string> = {}) {
  return new Request("https://example.com/api/route", { method: "POST", headers });
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("no credentials is 401, whatever Origin, Referer or Host claim", async () => {
  mockSanity({});
  const cases: Record<string, string>[] = [
    {},
    { origin: "https://example.com" },
    { referer: "https://example.com/studio/structure" },
    { origin: "https://example.com", referer: "https://example.com/studio", "x-forwarded-host": "example.com" },
  ];

  for (const headers of cases) {
    assert.equal((await authorizeStudioRequest(request(headers), CONFIG))?.status, 401, JSON.stringify(headers));
  }

  assert.equal(sanityCalls.length, 0, "no token means no call to Sanity");
});

test("a shared secret header opens nothing: the Studio session is the only way in", async () => {
  mockSanity({});

  const cases: Record<string, string>[] = [{ "x-api-secret": "anything" }, { authorization: "Basic dXNlcjpwYXNz" }];

  for (const headers of cases) {
    assert.equal((await authorizeStudioRequest(request(headers), CONFIG))?.status, 401, JSON.stringify(headers));
  }

  assert.equal(sanityCalls.length, 0);
});

test("a refusal is a private, uncacheable JSON error", async () => {
  mockSanity({});
  const response = await authorizeStudioRequest(request(), CONFIG);

  assert.equal(response?.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Object.keys((await response?.json()) ?? {}), ["error", "code", "hint"]);
});

test("a token Sanity does not recognise is 401", async () => {
  mockSanity({});
  assert.equal((await authorizeStudioRequest(request({ authorization: "Bearer made-up" }), CONFIG))?.status, 401);
});

test("a real Sanity login with no permissions on this project is 403", async () => {
  // What the Access API answers for any account outside the project: 200 and an empty permission list.
  mockSanity({ outsider: person() });
  assert.equal((await authorizeStudioRequest(request({ authorization: "Bearer outsider" }), CONFIG))?.status, 403);
});

test("read-only (viewer) and drafts-only (contributor) access is 403", async () => {
  mockSanity({
    viewer: person(projectReadPermission, readPermission),
    contributor: person(projectReadPermission, draftsOnlyPermission),
  });
  assert.equal((await authorizeStudioRequest(request({ authorization: "Bearer viewer" }), CONFIG))?.status, 403);
  assert.equal((await authorizeStudioRequest(request({ authorization: "Bearer contributor" }), CONFIG))?.status, 403);
});

test("an API token is 403 even with publish access", async () => {
  mockSanity({
    robot: {
      me: { status: 200, body: { id: "p-robot", provider: "sanity-token" } },
      permissions: { status: 200, pages: [[projectReadPermission, publishPermission]] },
    },
  });
  assert.equal((await authorizeStudioRequest(request({ authorization: "Bearer robot" }), CONFIG))?.status, 403);
});

const onProject = (projectId: string) => ({ resourceType: "project", resourceId: projectId });
const customUpdate = { type: "sanity.document.filter", name: "articles-only", action: "update", ...onProject("testproj") };

test("a person with publish access is let through, from either permission shape", async () => {
  mockSanity({
    editor: person(projectReadPermission, publishPermission),
    scopedEditor: person(projectReadPermission, { ...publishPermission, ...onProject("testproj") }),
    custom: person(projectReadPermission, customUpdate),
  });

  assert.equal(await authorizeStudioRequest(request({ authorization: "Bearer editor" }), CONFIG), null);
  assert.equal(await authorizeStudioRequest(request({ authorization: "Bearer scopedEditor" }), CONFIG), null);
  assert.equal(await authorizeStudioRequest(request({ authorization: "Bearer custom" }), CONFIG), null);
});

test("a grant on another project or resource is 403", async () => {
  mockSanity({
    otherProjectUpdate: person(projectReadPermission, { ...customUpdate, ...onProject("otherproj") }),
    otherProjectPublish: person(projectReadPermission, { ...publishPermission, ...onProject("otherproj") }),
    orgUpdate: person(projectReadPermission, { ...customUpdate, resourceType: "organization", resourceId: "testproj" }),
    unscopedUpdate: person(projectReadPermission, { type: "sanity.document.filter", name: "x", action: "update" }),
  });

  for (const token of ["otherProjectUpdate", "otherProjectPublish", "orgUpdate", "unscopedUpdate"]) {
    assert.equal((await authorizeStudioRequest(request({ authorization: `Bearer ${token}` }), CONFIG))?.status, 403, token);
  }
});

test("grantsPublish needs publish mode or a project-scoped update", () => {
  assert.equal(grantsPublish(publishPermission, "testproj"), true);
  assert.equal(grantsPublish({ ...publishPermission, ...onProject("testproj") }, "testproj"), true);
  assert.equal(grantsPublish({ ...publishPermission, ...onProject("otherproj") }, "testproj"), false);
  assert.equal(grantsPublish({ ...publishPermission, resourceType: "media-library", resourceId: "testproj" }, "testproj"), false);
  assert.equal(grantsPublish(customUpdate, "testproj"), true);
  assert.equal(grantsPublish({ ...customUpdate, action: "read" }, "testproj"), false);
  assert.equal(grantsPublish({ ...customUpdate, resourceId: undefined }, "testproj"), false);
  assert.equal(grantsPublish(draftsOnlyPermission, "testproj"), false);
});

test("it asks the documented endpoints: the Access API for permissions, the project's API version for /users/me", async () => {
  // A token no earlier test used: verdicts are cached for a minute.
  mockSanity({ "endpoint-check": person(publishPermission) });
  await authorizeStudioRequest(request({ authorization: "Bearer endpoint-check" }), CONFIG);

  assert.ok(sanityCalls.includes("https://testproj.api.sanity.io/v2099-01-31/users/me"), sanityCalls.join("\n"));
  assert.ok(
    sanityCalls.some((url) => url.startsWith("https://api.sanity.io/v2025-07-11/access/project/testproj/user-permissions/me?")),
    sanityCalls.join("\n")
  );
});

test("the /users/me API version comes from config, with or without a leading v", async () => {
  mockSanity({ "version-check": person(publishPermission) });
  await authorizeStudioRequest(request({ authorization: "Bearer version-check" }), {
    projectId: "vproj",
    apiVersion: "v2031-05-06",
  });
  assert.ok(sanityCalls.includes("https://vproj.api.sanity.io/v2031-05-06/users/me"));
});

test("permissions are read across pages", async () => {
  mockSanity({
    paged: {
      me: { status: 200, body: { id: "g-person", provider: "google" } },
      permissions: { status: 200, pages: [[projectReadPermission], [readPermission], [publishPermission]] },
    },
  });
  assert.equal(await authorizeStudioRequest(request({ authorization: "Bearer paged" }), CONFIG), null);
});

test("a verdict is cached per project, so repeated calls do not hit Sanity again", async () => {
  mockSanity({ cached: person(publishPermission) });
  await authorizeStudioRequest(request({ authorization: "Bearer cached" }), CONFIG);
  const afterFirst = sanityCalls.length;
  await authorizeStudioRequest(request({ authorization: "Bearer cached" }), CONFIG);
  assert.equal(sanityCalls.length, afterFirst);

  await authorizeStudioRequest(request({ authorization: "Bearer cached" }), { projectId: "otherproj", apiVersion: "2099-01-31" });
  assert.ok(sanityCalls.length > afterFirst, "another project asks Sanity afresh");
});

test("a Sanity outage fails closed with 503, is not cached, and logs its cause each time without the token", async (t) => {
  const logged = t.mock.method(console, "error", () => {});

  mockSanity({ "flaky-session-token": "network-error" });
  assert.equal((await authorizeStudioRequest(request({ authorization: "Bearer flaky-session-token" }), CONFIG))?.status, 503);

  mockSanity({ "flaky-session-token": { me: { status: 500 }, permissions: { status: 200, pages: [[publishPermission]] } } });
  assert.equal((await authorizeStudioRequest(request({ authorization: "Bearer flaky-session-token" }), CONFIG))?.status, 503);

  mockSanity({ "flaky-session-token": person(publishPermission) });
  assert.equal(await authorizeStudioRequest(request({ authorization: "Bearer flaky-session-token" }), CONFIG), null);

  assert.equal(logged.mock.callCount(), 2);
  assert.doesNotMatch(
    inspect(
      logged.mock.calls.map((call) => call.arguments),
      { depth: 8 }
    ),
    /flaky-session-token/
  );
});

test("an oversized or malformed bearer token is 401 without asking Sanity", async () => {
  mockSanity({});

  for (const token of ["a".repeat(513), "a".repeat(100_000), 'tok"en', "tok%0d%0aen", "tökén", "a,b", "a;b", "<script>", "==a"]) {
    const response = await authorizeStudioRequest(request({ authorization: `Bearer ${token}` }), CONFIG);

    assert.equal(response?.status, 401, token.slice(0, 40));
  }

  assert.equal(sanityCalls.length, 0);
});

test("a token at the length cap, in the RFC 6750 charset, still reaches Sanity", async () => {
  const token = `${"a".repeat(500)}-._~+/b==`;

  mockSanity({ [token]: person(publishPermission) });
  assert.equal(await authorizeStudioRequest(request({ authorization: `Bearer ${token}` }), CONFIG), null);
});

test("a flood of rejected tokens never evicts an editor's cached verdict", async () => {
  mockSanity({ "flood-editor": person(publishPermission) });
  assert.equal(await authorizeStudioRequest(request({ authorization: "Bearer flood-editor" }), CONFIG), null);

  for (let index = 0; index < 500; index++) {
    await authorizeStudioRequest(request({ authorization: `Bearer junk-${index}` }), CONFIG);
  }

  const beforeEditor = sanityCalls.length;
  assert.equal(await authorizeStudioRequest(request({ authorization: "Bearer flood-editor" }), CONFIG), null);
  assert.equal(sanityCalls.length, beforeEditor, "the editor's verdict is still cached");
});
