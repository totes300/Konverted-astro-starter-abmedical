/** Helpers for `scripts/sanity-project-setup/setup.ts`: env merging, Sanity CLI output, CORS origins. */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Copies `.env.example` to a missing `envPath`, so upserts preserve every template key. */
export function ensureEnvFromExample(envPath: string, examplePath: string): boolean {
  if (existsSync(envPath)) {
    return false;
  }

  if (!existsSync(examplePath)) {
    return false;
  }
  writeFileSync(envPath, readFileSync(examplePath, "utf8"), "utf8");
  return true;
}

/** Read from `.env.example` rather than hardcoded, so the script writes keys whatever host it is dropped into will read. */
export function readPublicEnvPrefix(exampleContents: string): string {
  return /^([A-Z0-9_]*?PUBLIC_)SANITY_PROJECT_ID\s*=/m.exec(exampleContents)?.[1] ?? "PUBLIC_";
}

/** 64 hex characters, the same strength as `openssl rand -hex 32`; the app's env validation refuses anything under 32. */
export function generateEnvSecret(): string {
  return randomBytes(32).toString("hex");
}

/** Reports an existing value rather than replacing it: a webhook or a signed-in editor may depend on it. */
export function envSecretStatus(contents: string, key: string, minLength: number): "missing" | "short" | "ok" {
  const value = readEnvValue(contents, key);

  if (!value) {
    return "missing";
  }

  return value.length < minLength ? "short" : "ok";
}

/** The value a `.env` file assigns to `key` (last assignment wins, quotes stripped); empty when unset. */
export function readEnvValue(contents: string, key: string): string {
  let value = "";

  for (const line of contents.split(/\r?\n/)) {
    const match = /^(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(line);

    if (match?.[1] === key) {
      value = (match[2] ?? "").trim().replace(/^(["'])(.*)\1$/, "$2");
    }
  }

  return value;
}

/** WHATWG URL normalizes `0`, `[::ffff:0.0.0.0]` and the IPv4-mapped forms to these spellings. */
const LOCAL_ADDRESSES = new Set(["::1", "::", "0.0.0.0", "::ffff:0:0"]);

/** Loopback dev origins: a credentialed CORS entry there lets any app on that port act as a signed-in user. */
export function isLoopbackOrigin(origin: string): boolean {
  const withoutAnyPort = origin.replace(/:\*$/, "");

  try {
    const { hostname } = new URL(withoutAnyPort.includes("://") ? withoutAnyPort : `http://${withoutAnyPort}`);
    const host = hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, "");

    return (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      LOCAL_ADDRESSES.has(host) ||
      /^127(\.\d{1,3}){3}$/.test(host) ||
      /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(host)
    );
  } catch {
    return false;
  }
}

/** A `*` origin matches hosts nobody listed, so credentials there are never granted by default. */
export function corsOriginKind(origin: string): "wildcard" | "loopback" | "remote" {
  if (origin.includes("*")) {
    return "wildcard";
  }

  return isLoopbackOrigin(origin) ? "loopback" : "remote";
}

/** Read from the example so the CORS default matches the port the dev server actually listens on. */
export function readLocalSiteOrigin(exampleContents: string, fallback: string): string {
  return /^[A-Z0-9_]*\s*=\s*(http:\/\/localhost:\d+)\s*$/m.exec(exampleContents)?.[1] ?? fallback;
}

/** The first balanced JSON object in CLI stdout, past spinner noise; errors never quote the output, which may hold a token. */
export function parseJsonFromCliOutput(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  const start = trimmed.indexOf("{");

  if (start === -1) {
    throw new Error("Expected a JSON object in the Sanity CLI output.");
  }

  const end = findMatchingBrace(trimmed, start);

  if (end === -1) {
    throw new Error("Unterminated JSON object in the Sanity CLI output.");
  }

  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new Error("Invalid JSON in the Sanity CLI output.");
  }
}

/** `sanity tokens add --json`: the secret is `token` (older CLIs said `key`); errors never echo it. */
export function parseCreatedToken(obj: Record<string, unknown>): { id: string; secret: string } {
  const secret = obj.token ?? obj.key;

  if (typeof obj.id !== "string" || !obj.id) {
    throw new Error("Unexpected token response from the Sanity CLI (missing id).");
  }

  if (typeof secret !== "string" || !secret) {
    throw new Error("Unexpected token response from the Sanity CLI (missing token).");
  }

  return { id: obj.id, secret };
}

/** Accounts for nested objects and braces inside string literals; -1 when the object is never closed. */
function findMatchingBrace(text: string, open: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = open; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;

      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

export function runSanityCli(args: string[]): { ok: boolean; stdout: string; stderr: string; status: number | null } {
  const binName = process.platform === "win32" ? "sanity.cmd" : "sanity";
  const bin = join(process.cwd(), "node_modules", ".bin", binName);
  const result = spawnSync(bin, args, {
    encoding: "utf-8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // A spawn-level failure leaves `status` null, so surface `error` or callers print an empty message.
  const spawnError = result.error ? result.error.message : "";

  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr || spawnError,
    status: result.status,
  };
}

/** Inherited stdio and layered env, for the long commands that print their own progress and read the project from env. */
export function runSanityCliStreaming(
  args: string[],
  extraEnv: Record<string, string> = {}
): { ok: boolean; error: string; status: number | null } {
  const binName = process.platform === "win32" ? "sanity.cmd" : "sanity";
  const bin = join(process.cwd(), "node_modules", ".bin", binName);
  const result = spawnSync(bin, args, {
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });

  return {
    ok: !result.error && result.status === 0,
    error: result.error ? result.error.message : "",
    status: result.status,
  };
}

export function formatEnvValue(value: string): string {
  if (/[\s#'"\\]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

/**
 * Upserts KEY=value pairs in a `.env` file, preserving unrelated lines and order where possible.
 */
export function upsertEnvFile(filePath: string, updates: Record<string, string>): void {
  const keysRemaining = new Set(Object.keys(updates));
  const lines: string[] = existsSync(filePath) ? readFileSync(filePath, "utf8").split(/\r?\n/) : [];

  const out: string[] = [];
  for (const line of lines) {
    const match = /^(?:export\s+)?([A-Za-z_]\w*)\s*=/.exec(line);

    if (match?.[1] && keysRemaining.has(match[1])) {
      const key = match[1];
      out.push(`${key}=${formatEnvValue(updates[key] ?? "")}`);
      keysRemaining.delete(key);
    } else {
      out.push(line);
    }
  }

  for (const key of keysRemaining) {
    out.push(`${key}=${formatEnvValue(updates[key] ?? "")}`);
  }

  const body = out.join("\n");
  writeFileSync(filePath, body.endsWith("\n") ? body : `${body}\n`, "utf8");
}
