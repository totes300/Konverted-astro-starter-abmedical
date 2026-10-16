import { basicAuthChallenge } from "~/features/auth/basic-auth";
import type { FormRequestVerdict } from "./request-guard";

/** A rejected parse answers with the whole map, not one sentence, so the browser can report it inline. */
export type FormFailure = { error?: string; fieldErrors?: Record<string, string | undefined> };

export type FormResponse = { ok: true } | ({ ok: false } & FormFailure);

export function formOk() {
  return Response.json({ ok: true } satisfies FormResponse);
}

export function formFailed(status: number, failure: FormFailure) {
  return Response.json({ ok: false, ...failure } satisfies FormResponse, { status });
}

/** One answer for every request the form never sends, so it confirms nothing to a script about which check failed. */
export function formRefused() {
  return formFailed(400, { error: "Something went wrong. Please try again." });
}

/** Neither let through nor challenged: the lock is unreadable, or no credentials are set. */
export function formUnavailable() {
  const response = formFailed(503, { error: "The form cannot be sent right now. Please try again in a moment." });

  response.headers.set("Retry-After", "10");

  return response;
}

/** An aborted write may still land, so that visitor is told to wait rather than to send it again. */
export function formWriteFailed(error: unknown) {
  const name = (error as { name?: unknown } | null)?.name;

  if (name === "TimeoutError" || name === "AbortError") {
    return formFailed(504, { error: "We may have received this already. Please wait a moment before sending it again." });
  }

  return formFailed(500, { error: "Failed to submit form. Please try again later." });
}

/** The answer for a request the endpoint does not read; null when the verdict is to read the body. */
export function formRequestAnswer(verdict: FormRequestVerdict): Response | null {
  if (verdict === "ok") {
    return null;
  }

  // The pages' realm, so a browser already signed in to the site resends its credentials without asking.
  if (verdict === "auth") {
    return basicAuthChallenge();
  }

  if (verdict === "unavailable") {
    return formUnavailable();
  }

  return formRefused();
}
