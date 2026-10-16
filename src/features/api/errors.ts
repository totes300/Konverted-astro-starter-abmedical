/**
 * Uniform machine-readable error body for API endpoints: `error`, a stable `code` slug, an optional `hint`.
 * Documented in the OpenAPI description (`~/features/api/openapi`).
 */
export type ApiErrorBody = {
  error: string;
  code: string;
  hint?: string;
};

const PRIVATE_NO_STORE = "private, no-store";

/** JSON that no shared cache may keep: Studio-gated and per-user answers, success and error alike. */
export function privateJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("cache-control", PRIVATE_NO_STORE);

  return Response.json(body, { ...init, headers });
}

export function apiErrorResponse(status: number, body: ApiErrorBody): Response {
  return privateJson(body, { status });
}

/** Logs the original error server-side and answers with fixed text, so upstream details never reach the caller. */
export function internalErrorResponse(cause: unknown, body: ApiErrorBody, status = 500): Response {
  console.error(cause);

  return apiErrorResponse(status, body);
}
