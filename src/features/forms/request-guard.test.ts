import assert from "node:assert/strict";
import { test } from "node:test";
import { checkFormRequest, type FormRequestContext, hasFormShape, MAX_FORM_BYTES, readFormData } from "./request-guard";

const CREDENTIALS = { username: "editor", password: "a-long-random-password" };
const MULTIPART = "multipart/form-data; boundary=----form";
const URL = "https://example.com/api/contact-form";

function basic(username: string, password: string) {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

function context(overrides: Partial<FormRequestContext> = {}): FormRequestContext {
  return {
    isDev: false,
    isSiteWideBasicAuthEnabled: async () => true,
    credentials: CREDENTIALS,
    draftSession: false,
    ...overrides,
  };
}

const open = context({ isSiteWideBasicAuthEnabled: async () => false });

function verdict(headers: Record<string, string>, ctx: FormRequestContext = open) {
  return checkFormRequest(new Headers(headers), ctx);
}

test("hasFormShape: only the multipart body the form sends", () => {
  assert.equal(hasFormShape(new Headers({ "content-type": MULTIPART })), true);
  assert.equal(hasFormShape(new Headers({ "content-type": "Multipart/Form-Data; boundary=x" })), true);

  for (const type of ["application/x-www-form-urlencoded", "application/json", "text/plain", "multipart/mixed; boundary=x", ""]) {
    assert.equal(hasFormShape(new Headers({ "content-type": type })), false, type);
  }

  assert.equal(hasFormShape(new Headers()), false, "no content type");
});

test("hasFormShape: a declared length over the cap is refused", () => {
  assert.equal(hasFormShape(new Headers({ "content-type": MULTIPART, "content-length": String(MAX_FORM_BYTES) })), true);
  assert.equal(hasFormShape(new Headers({ "content-type": MULTIPART, "content-length": String(MAX_FORM_BYTES + 1) })), false);
  assert.equal(hasFormShape(new Headers({ "content-type": MULTIPART, "content-length": "1000003" })), false);
  assert.equal(hasFormShape(new Headers({ "content-type": MULTIPART, "content-length": "-1" })), false);
  assert.equal(hasFormShape(new Headers({ "content-type": MULTIPART, "content-length": "1e3" })), false);
});

test("checkFormRequest: a headerless script post is refused before anything else", async () => {
  assert.equal(await verdict({}), "shape");
  assert.equal(await verdict({ "content-type": "application/x-www-form-urlencoded" }), "shape");
  assert.equal(await verdict({ "content-type": MULTIPART }), "ok");
});

test("site-wide Basic Auth: a form post without the right credentials is challenged", async () => {
  for (const authorization of [
    undefined,
    "",
    basic(CREDENTIALS.username, "wrong"),
    basic("someone", CREDENTIALS.password),
    basic(CREDENTIALS.username, `${CREDENTIALS.password}x`),
    `Bearer ${CREDENTIALS.password}`,
    "Basic !!!not-base64",
  ]) {
    const headers: Record<string, string> = { "content-type": MULTIPART };

    if (authorization !== undefined) {
      headers.authorization = authorization;
    }

    assert.equal(await verdict(headers, context()), "auth", String(authorization));
  }

  assert.equal(
    await verdict({ "content-type": MULTIPART, authorization: basic(CREDENTIALS.username, CREDENTIALS.password) }, context()),
    "ok"
  );
});

test("site-wide Basic Auth: a wrong shape stays refused, whatever the lock and the credentials", async () => {
  const headers = { "content-type": "application/x-www-form-urlencoded" };

  assert.equal(await verdict(headers, context()), "shape");
  assert.equal(
    await verdict({ ...headers, authorization: basic(CREDENTIALS.username, CREDENTIALS.password) }, context()),
    "shape"
  );
  assert.equal(await verdict(headers, context({ draftSession: true })), "shape");
});

test("site-wide Basic Auth with no credentials configured turns everyone away but a preview session", async () => {
  const headers = { "content-type": MULTIPART, authorization: basic(CREDENTIALS.username, CREDENTIALS.password) };

  assert.equal(await verdict(headers, context({ credentials: null })), "unavailable");
  assert.equal(await verdict({ "content-type": MULTIPART }, context({ credentials: null, draftSession: true })), "ok");
});

test("a verified preview session passes like it does on a page", async () => {
  assert.equal(await verdict({ "content-type": MULTIPART }, context({ draftSession: true })), "ok");
});

test("an unreadable Basic Auth state fails closed", async () => {
  const realConsoleError = console.error;

  console.error = () => {};

  try {
    const down = context({
      isSiteWideBasicAuthEnabled: async () => {
        throw new Error("Sanity down");
      },
    });

    assert.equal(await verdict({ "content-type": MULTIPART }, down), "unavailable");
  } finally {
    console.error = realConsoleError;
  }
});

test("Basic Auth is skipped under astro dev", async () => {
  assert.equal(await verdict({ "content-type": MULTIPART }, context({ isDev: true })), "ok");
});

test("readFormData: reads what the form sends", async () => {
  const body = new FormData();

  body.append("firstName", "Ada");
  body.append("services", "design");
  body.append("services", "seo");

  const formData = await readFormData(new Request(URL, { method: "POST", body }));

  assert.equal(formData?.get("firstName"), "Ada");
  assert.deepEqual(formData?.getAll("services"), ["design", "seo"]);
});

test("readFormData: a body past the cap is refused, declared length or not", async () => {
  const body = new FormData();

  body.append("phoneDialCode", "1".repeat(1_000_003));

  assert.equal(await readFormData(new Request(URL, { method: "POST", body })), null);

  const encoded = new Response(body);
  const contentType = encoded.headers.get("content-type") ?? "";
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  const chunked = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

  const request = new Request(URL, {
    method: "POST",
    body: chunked,
    headers: { "content-type": contentType },
    duplex: "half",
  } as RequestInit);

  assert.equal(request.headers.get("content-length"), null);
  assert.equal(await readFormData(request), null);
});

test("readFormData: an unreadable body is null, not a throw", async () => {
  assert.equal(
    await readFormData(new Request(URL, { method: "POST", body: "not multipart", headers: { "content-type": MULTIPART } })),
    null
  );
  assert.equal(await readFormData(new Request(URL, { method: "POST" })), null);
});
