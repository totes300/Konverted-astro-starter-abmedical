// The revalidate webhook after its secret check; the platform calls are injected so tests can order them.
// Each step and why it sits where it does: docs/sanity/revalidation-and-caching.md#the-webhook

import { z } from "zod";
import { type ApiErrorBody, apiErrorResponse, internalErrorResponse, privateJson } from "~/features/api/errors";
import { parseWebhookJson, verifyWebhookDelivery, WEBHOOK_SIGNATURE_HEADER } from "~/features/api/webhook-signature";
import { docCacheTags } from "~/lib/cache";

/** Sanity fires the webhook before every Content Lake replica has the change. */
export const CONTENT_LAKE_SETTLE_MS = 3000;

const WebhookSchema = z.object({
  _id: z.string().min(1),
  _type: z.string().min(1),
  uri: z.string().min(1).optional().nullable(),
});

const REVALIDATION_FAILED: ApiErrorBody = {
  error: "Revalidation failed.",
  code: "internal_error",
  hint: "Sanity retries failed webhook deliveries; no action needed for transient errors.",
};

export type PublishSteps = {
  secret: string;
  settle: () => Promise<unknown>;
  bumpContentVersion: () => Promise<unknown>;
  invalidateTags: (tags: string[]) => Promise<unknown>;
};

export async function handleRevalidateDelivery(request: Request, steps: PublishSteps): Promise<Response> {
  try {
    const raw = await request.text();
    const verdict = await verifyWebhookDelivery(raw, request.headers.get(WEBHOOK_SIGNATURE_HEADER), steps.secret, Date.now());

    if (verdict === "stale") {
      return apiErrorResponse(401, {
        error: "Missing or expired webhook signature.",
        code: "stale_signature",
        hint: "Deliveries are accepted for one hour after Sanity signs them.",
      });
    }

    if (verdict === "invalid") {
      return apiErrorResponse(401, {
        error: "Invalid webhook signature.",
        code: "invalid_signature",
        hint: "The webhook secret must match SANITY_REVALIDATE_SECRET.",
      });
    }

    const parsed = WebhookSchema.safeParse(parseWebhookJson(raw));

    if (!parsed.success) {
      return apiErrorResponse(400, {
        error: "Malformed webhook payload.",
        code: "invalid_payload",
        hint: "The projection must include _id, _type, and optionally uri.",
      });
    }

    const tags = docCacheTags(parsed.data);

    await steps.settle();
    // After the settle: the gate refetch a bump forces must not read a replica that lacks the publish.
    const [bump] = await Promise.allSettled([steps.bumpContentVersion()]);
    // Bump first, or a render between the two stores a CDN-stale page no later publish would expire.
    await steps.invalidateTags(tags);

    // Only after the tags expire, so a broken store never stops content from refreshing; the 500 still gets a redelivery.
    if (bump.status === "rejected") {
      return internalErrorResponse(bump.reason, REVALIDATION_FAILED);
    }

    return privateJson({ body: parsed.data, tags });
  } catch (err) {
    return internalErrorResponse(err, REVALIDATION_FAILED);
  }
}
