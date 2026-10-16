import { apiErrorResponse } from "~/features/api/errors";

const RETRY_AFTER_SECONDS = "10";
// A Sanity 4xx means a wrong or revoked view token, which no retry fixes; a timeout or a rate limit passes.
const TRANSIENT_CLIENT_STATUSES = new Set([408, 429]);
const ERROR_NAME = /^\w{1,40}$/;
const NETWORK_CODE = /^[A-Z][A-Z0-9_]{1,39}$/;

type FailedCheck = { name?: unknown; statusCode?: unknown; code?: unknown; cause?: { code?: unknown } | null };

/** A failed check's name, status and network code; never its message or request, which can quote the preview secret. */
function previewCheckSummary(error: unknown): string {
  const { name, statusCode, code, cause } = (typeof error === "object" && error !== null ? error : {}) as FailedCheck;
  const networkCode = [code, cause?.code].find((value) => typeof value === "string" && NETWORK_CODE.test(value));

  return [
    typeof name === "string" && ERROR_NAME.test(name) ? name : "Error",
    typeof statusCode === "number" ? String(statusCode) : null,
    typeof networkCode === "string" ? networkCode : null,
  ]
    .filter((part) => part !== null)
    .join(" ");
}

/** The answer when Sanity could not check the secret: a 500 when it refused the token, a retryable 503 otherwise. */
export function previewCheckFailed(error: unknown): Response {
  console.error("[draft-mode] Sanity could not check the preview secret:", previewCheckSummary(error));

  const statusCode = (error as FailedCheck | null)?.statusCode;

  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500 && !TRANSIENT_CLIENT_STATUSES.has(statusCode)) {
    return apiErrorResponse(500, {
      error: "Sanity refused the preview secret check.",
      code: "preview_misconfigured",
      hint: "Check that SANITY_API_VIEW_TOKEN is a valid token for this project and dataset.",
    });
  }

  const unavailable = apiErrorResponse(503, {
    error: "Could not verify the preview secret.",
    code: "preview_unavailable",
    hint: "Sanity did not answer. Reopen the preview in a moment.",
  });
  unavailable.headers.set("retry-after", RETRY_AFTER_SECONDS);

  return unavailable;
}
