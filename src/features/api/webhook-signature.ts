import { encodeSignatureHeader, isSignatureError } from "@sanity/webhook";
import { timingSafeEqual } from "~/features/auth/basic-auth";

// Same header grammar as `@sanity/webhook`: `t=<ms timestamp>,v1=<signature>`.
const SIGNATURE_HEADER = /^t=(\d+)[, ]+v1=([^, ]+)$/;
export const WEBHOOK_SIGNATURE_HEADER = "sanity-webhook-signature";
// Wide on purpose: Sanity sends one request at a time, so a bulk publish can sit queued for minutes.
export const WEBHOOK_MAX_AGE_MS = 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;

export type WebhookVerdict = "stale" | "invalid" | "ok";

function parseSignatureHeader(header: string | null) {
  const match = SIGNATURE_HEADER.exec((header ?? "").trim());
  const timestamp = Number(match?.[1]);
  const signature = match?.[2];

  if (!signature || !Number.isSafeInteger(timestamp)) {
    return null;
  }

  return { timestamp, signature };
}

function isRecent(timestamp: number, now: number) {
  return timestamp <= now + MAX_CLOCK_SKEW_MS && now - timestamp <= WEBHOOK_MAX_AGE_MS;
}

/** Over the raw text and before any parse, so an unsigned body never reaches `JSON.parse`. */
export async function verifyWebhookDelivery(
  raw: string,
  header: string | null,
  secret: string,
  now: number
): Promise<WebhookVerdict> {
  const parsed = parseSignatureHeader(header);

  if (!parsed || !isRecent(parsed.timestamp, now)) {
    return "stale";
  }

  let expected: string;

  try {
    expected = await encodeSignatureHeader(raw, parsed.timestamp, secret);
  } catch (error) {
    // The library refuses to sign an empty body; that is a bad delivery, not a server fault.
    if (isSignatureError(error)) {
      return "invalid";
    }

    throw error;
  }

  // `@sanity/webhook` compares with `!==`; this compares digests in constant time, over the canonical header.
  return timingSafeEqual(`t=${parsed.timestamp},v1=${parsed.signature}`, expected) ? "ok" : "invalid";
}

/** The verified body as JSON, or null when it is not JSON. */
export function parseWebhookJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
