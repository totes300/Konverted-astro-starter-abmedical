import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  corsOriginKind,
  ensureEnvFromExample,
  envSecretStatus,
  formatEnvValue,
  generateEnvSecret,
  isLoopbackOrigin,
  parseCreatedToken,
  parseJsonFromCliOutput,
  readEnvValue,
  readLocalSiteOrigin,
  readPublicEnvPrefix,
  upsertEnvFile,
} from "./lib";

test("formatEnvValue quotes values with whitespace or special characters", () => {
  assert.equal(formatEnvValue("plainvalue"), "plainvalue");
  assert.equal(formatEnvValue("has space"), '"has space"');
  assert.equal(formatEnvValue('has"quote'), '"has\\"quote"');
});

test("parseJsonFromCliOutput ignores spinner noise before the object", () => {
  const parsed = parseJsonFromCliOutput('⠋ working...\n{"projectId":"abc"}');

  assert.equal(parsed.projectId, "abc");
});

test("parseJsonFromCliOutput ignores trailing notices after the object", () => {
  const parsed = parseJsonFromCliOutput('{"token":"sk-123"}\n\nA new version of sanity is available.');

  assert.equal(parsed.token, "sk-123");
});

test("parseJsonFromCliOutput handles nested objects and braces inside strings", () => {
  const parsed = parseJsonFromCliOutput('prefix {"a":{"b":1},"label":"a } b"} trailing');

  assert.deepEqual(parsed, { a: { b: 1 }, label: "a } b" });
});

test("parseJsonFromCliOutput throws when no object is present", () => {
  assert.throws(() => parseJsonFromCliOutput("no json here"));
});

const SECRET = "skSuperSecretTokenValue";

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  return "";
}

test("parseCreatedToken reads the current CLI's `token` field and the older `key`", () => {
  assert.deepEqual(parseCreatedToken({ id: "g-abc", label: "Frontend - View", memberships: [], token: SECRET }), {
    id: "g-abc",
    secret: SECRET,
  });
  assert.deepEqual(parseCreatedToken({ id: "g-abc", key: SECRET }), { id: "g-abc", secret: SECRET });
});

test("parseCreatedToken errors never echo the CLI JSON", () => {
  const missingId = messageOf(() => parseCreatedToken({ token: SECRET }));
  const missingSecret = messageOf(() => parseCreatedToken({ id: "g-abc", label: SECRET }));

  assert.match(missingId, /missing id/);
  assert.match(missingSecret, /missing token/);
  assert.ok(!missingId.includes(SECRET));
  assert.ok(!missingSecret.includes(SECRET));
});

test("parseJsonFromCliOutput never quotes the output in its errors", () => {
  for (const stdout of [`token: ${SECRET}`, `{"token":"${SECRET}"`, `{"token": ${SECRET}}`]) {
    const message = messageOf(() => parseJsonFromCliOutput(stdout));

    assert.ok(message, stdout);
    assert.ok(!message.includes(SECRET), message);
  }
});

test("generateEnvSecret is 64 hex characters and never repeats", () => {
  const first = generateEnvSecret();

  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, generateEnvSecret());
});

test("envSecretStatus generates only a missing secret and flags one under the floor", () => {
  assert.equal(envSecretStatus("", "SANITY_REVALIDATE_SECRET", 32), "missing");
  assert.equal(envSecretStatus("SANITY_REVALIDATE_SECRET=\n", "SANITY_REVALIDATE_SECRET", 32), "missing");
  assert.equal(envSecretStatus("BASIC_AUTH_PASSWORD=abc\n", "SANITY_REVALIDATE_SECRET", 32), "missing");
  assert.equal(envSecretStatus("SANITY_REVALIDATE_SECRET=short\n", "SANITY_REVALIDATE_SECRET", 32), "short");
  assert.equal(envSecretStatus(`SANITY_REVALIDATE_SECRET=${"a".repeat(31)}\n`, "SANITY_REVALIDATE_SECRET", 32), "short");
  assert.equal(envSecretStatus(`SANITY_REVALIDATE_SECRET=${"a".repeat(32)}\n`, "SANITY_REVALIDATE_SECRET", 32), "ok");
  assert.equal(envSecretStatus(`SANITY_REVALIDATE_SECRET=${generateEnvSecret()}\n`, "SANITY_REVALIDATE_SECRET", 32), "ok");
});

test("readEnvValue reads the last assignment, strips quotes and treats a blank as unset", () => {
  assert.equal(readEnvValue("SANITY_REVALIDATE_SECRET=\n", "SANITY_REVALIDATE_SECRET"), "");
  assert.equal(readEnvValue("# SANITY_REVALIDATE_SECRET=commented\n", "SANITY_REVALIDATE_SECRET"), "");
  assert.equal(readEnvValue('SANITY_REVALIDATE_SECRET="abc"\n', "SANITY_REVALIDATE_SECRET"), "abc");
  assert.equal(readEnvValue("export SANITY_REVALIDATE_SECRET=a\nSANITY_REVALIDATE_SECRET=b", "SANITY_REVALIDATE_SECRET"), "b");
  assert.equal(readEnvValue("OTHER_SANITY_REVALIDATE_SECRET=x\n", "SANITY_REVALIDATE_SECRET"), "");
});

test("isLoopbackOrigin spots every local dev origin and nothing public", () => {
  for (const origin of [
    "http://localhost:3000",
    "localhost:3000",
    "http://LOCALHOST:3000",
    "http://app.localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "http://0.0.0.0:3000",
    "http://0:3000",
    "http://[::]:3000",
    "http://[::ffff:127.0.0.1]:3000",
    "http://[::ffff:127.1.2.3]:3000",
    "http://[::ffff:0.0.0.0]:3000",
    "http://127.1:3000",
    "http://localhost.:3000",
    "http://localhost:*",
    "http://127.0.0.1:*",
    "localhost:*",
  ]) {
    assert.equal(isLoopbackOrigin(origin), true, origin);
  }

  for (const origin of [
    "https://example.com",
    "https://localhost.example.com",
    "http://192.168.1.10:3000",
    "http://[::ffff:8.8.8.8]:3000",
    "http://128.0.0.1:3000",
    "not a url",
    "*",
    "https://example.com:*",
  ]) {
    assert.equal(isLoopbackOrigin(origin), false, origin);
  }
});

test("corsOriginKind puts every origin with a wildcard behind its own credentials question", () => {
  for (const origin of ["*", "http://localhost:*", "http://127.0.0.1:*", "https://*.example.com", "https://*"]) {
    assert.equal(corsOriginKind(origin), "wildcard", origin);
  }

  assert.equal(corsOriginKind("http://localhost:3000"), "loopback");
  assert.equal(corsOriginKind("http://[::1]:3000"), "loopback");
  assert.equal(corsOriginKind("https://example.com"), "remote");
  assert.equal(corsOriginKind("https://studio.example.com"), "remote");
});

test("upsertEnvFile updates existing keys and appends new ones, preserving other lines", () => {
  const dir = mkdtempSync(join(tmpdir(), "env-test-"));
  const file = join(dir, ".env");

  try {
    writeFileSync(file, "# comment\nKEEP_ME=untouched\nPUBLIC_SANITY_PROJECT_ID=old\n", "utf8");
    upsertEnvFile(file, { PUBLIC_SANITY_PROJECT_ID: "new", SANITY_API_VIEW_TOKEN: "token123" });

    const out = readFileSync(file, "utf8");

    assert.match(out, /# comment/);
    assert.match(out, /KEEP_ME=untouched/);
    assert.match(out, /PUBLIC_SANITY_PROJECT_ID=new/);
    assert.doesNotMatch(out, /PUBLIC_SANITY_PROJECT_ID=old/);
    assert.match(out, /SANITY_API_VIEW_TOKEN=token123/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("upsertEnvFile replaces an exported key in place rather than duplicating it", () => {
  const dir = mkdtempSync(join(tmpdir(), "env-test-"));
  const file = join(dir, ".env");

  try {
    writeFileSync(file, "export FOO=old\n", "utf8");
    upsertEnvFile(file, { FOO: "new" });

    const out = readFileSync(file, "utf8");

    assert.match(out, /FOO=new/);
    assert.equal(out.match(/FOO=/g)?.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureEnvFromExample copies the example only when the target is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "env-test-"));
  const example = join(dir, ".env.example");
  const target = join(dir, ".env");

  try {
    writeFileSync(example, "PUBLIC_SITE_URL=http://localhost:4321\n", "utf8");

    assert.equal(ensureEnvFromExample(target, example), true);
    assert.match(readFileSync(target, "utf8"), /PUBLIC_SITE_URL/);
    assert.equal(ensureEnvFromExample(target, example), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The two host facts read from `.env.example`, so the wizard writes keys the host reads and a CORS default that matches.
test("readPublicEnvPrefix takes the prefix the example gives the Sanity project id", () => {
  assert.equal(readPublicEnvPrefix("PUBLIC_SANITY_PROJECT_ID=abc\n"), "PUBLIC_");
  assert.equal(readPublicEnvPrefix("NEXT_PUBLIC_SANITY_PROJECT_ID=abc\n"), "NEXT_PUBLIC_");
  assert.equal(readPublicEnvPrefix("VITE_PUBLIC_SANITY_PROJECT_ID = abc\n"), "VITE_PUBLIC_");
});

test("readPublicEnvPrefix ignores a commented line and falls back when the key is absent", () => {
  assert.equal(readPublicEnvPrefix("# NEXT_PUBLIC_SANITY_PROJECT_ID=abc\nPUBLIC_SANITY_PROJECT_ID=abc\n"), "PUBLIC_");
  assert.equal(readPublicEnvPrefix("SANITY_API_EDIT_TOKEN=\n"), "PUBLIC_");
  assert.equal(readPublicEnvPrefix(""), "PUBLIC_");
});

test("readLocalSiteOrigin takes the dev origin the example points at, whatever the key is called", () => {
  assert.equal(readLocalSiteOrigin("PUBLIC_SITE_URL=http://localhost:4321\n", "http://localhost:3000"), "http://localhost:4321");
  assert.equal(readLocalSiteOrigin("NEXT_PUBLIC_URL=http://localhost:3000\n", "http://localhost:4321"), "http://localhost:3000");
});

test("readLocalSiteOrigin falls back when the example carries no local origin", () => {
  assert.equal(readLocalSiteOrigin("PUBLIC_SITE_URL=https://example.com\n", "http://localhost:4321"), "http://localhost:4321");
  assert.equal(readLocalSiteOrigin("", "http://localhost:4321"), "http://localhost:4321");
});
