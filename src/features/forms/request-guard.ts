import { type BasicAuthCredentials, hasBasicCredentials } from "~/features/auth/basic-auth";

/** No form on the site comes near it; checked against the declared length and again on the bytes that arrive. */
export const MAX_FORM_BYTES = 64 * 1024;

// `FormElement` posts a `FormData` body with `fetch`, which always goes out as multipart.
const FORM_CONTENT_TYPE = "multipart/form-data";

export type FormRequestContext = {
  isDev: boolean;
  isSiteWideBasicAuthEnabled: () => Promise<boolean>;
  credentials: BasicAuthCredentials | null;
  /** The middleware's verified preview session (`locals.draftSession`), which skips Basic Auth on pages too. */
  draftSession: boolean;
};

/** What a public form endpoint does with a request: read it, refuse it, challenge it, or ask for a retry. */
export type FormRequestVerdict = "ok" | "path" | "shape" | "auth" | "unavailable";

/** The content type and declared size `FormElement` sends; anything else is refused before the body is read. */
export function hasFormShape(headers: Headers): boolean {
  const mediaType = headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();

  if (mediaType !== FORM_CONTENT_TYPE) {
    return false;
  }

  const length = headers.get("content-length");

  return length === null || (/^\d+$/.test(length) && Number(length) <= MAX_FORM_BYTES);
}

/** The middleware never gates `/api/`, so a public endpoint asks for what a page under site-wide Basic Auth would. */
async function siteWideBasicAuthVerdict(headers: Headers, context: FormRequestContext): Promise<FormRequestVerdict> {
  const { isDev, credentials, draftSession } = context;

  if (isDev || draftSession) {
    return "ok";
  }

  if (credentials && hasBasicCredentials(headers.get("authorization"), credentials.username, credentials.password)) {
    return "ok";
  }

  let isLocked: boolean;

  try {
    isLocked = await context.isSiteWideBasicAuthEnabled();
  } catch (error) {
    console.error("Form refused: Basic Auth state unavailable", error);

    return "unavailable";
  }

  if (!isLocked) {
    return "ok";
  }

  // Unconfigured, no header can pass and a challenge would only loop; pages answer 503 here too.
  return credentials ? "auth" : "unavailable";
}

/** The shape is checked first, so a request the form never sends learns nothing about the site's lock. */
export async function checkFormRequest(headers: Headers, context: FormRequestContext): Promise<FormRequestVerdict> {
  if (!hasFormShape(headers)) {
    return "shape";
  }

  return siteWideBasicAuthVerdict(headers, context);
}

/** Null when unreadable or past `maxBytes`: a chunked body declares no length, so the cap counts what arrives. */
export async function readFormData(request: Request, maxBytes = MAX_FORM_BYTES): Promise<FormData | null> {
  if (!request.body) {
    return null;
  }

  let size = 0;

  const capped = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;

        if (size > maxBytes) {
          controller.error(new Error(`Form body over ${maxBytes} bytes`));

          return;
        }

        controller.enqueue(chunk);
      },
    })
  );

  try {
    return await new Response(capped, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return null;
  }
}
