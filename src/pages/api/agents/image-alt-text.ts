import type { APIRoute } from "astro";
import { buildDescriptionSourceUrl, generateAltText, isDescribableAsset, isImageAssetId } from "~/features/agents/alt-text";
import { AltTextAssetQuery, AltTextBacklogQuery, AltTextSettingsQuery, AltTextStatsQuery } from "~/features/agents/query";
import { authorizeStudioRequest } from "~/features/api/auth";
import { apiErrorResponse, internalErrorResponse, privateJson } from "~/features/api/errors";
import type {
  AltTextAssetQueryResult,
  AltTextBacklogQueryResult,
  AltTextSettingsQueryResult,
  AltTextStatsQueryResult,
} from "~/sanity/types";
import { sanityEditClient } from "../../../sanity/lib/client";

// Studio-triggered alt text generation.
export const prerender = false;

/** Each description is a round trip, so the batch must finish inside the function's time budget; the panel loops. */
const DEFAULT_BATCH_SIZE = 3;
const MAX_BATCH_SIZE = 8;

type AltTextResult = {
  _id: string;
  status: "described" | "skipped" | "failed";
  altText?: string;
  reason?: string;
};

/** Describe one asset and write the result to `sanity.imageAsset.altText`; only the asset read can throw. */
async function describeAsset(assetId: string, guidance: string, force: boolean): Promise<AltTextResult> {
  const asset = await sanityEditClient.fetch<AltTextAssetQueryResult>(AltTextAssetQuery, { assetId });

  if (!asset?.url) {
    return { _id: assetId, status: "skipped", reason: "Asset not found." };
  }

  // Re-checked here: two Studio tabs can observe one upload, and an editor's own correction must survive.
  if (asset.altText && !force) {
    return { _id: assetId, status: "skipped", reason: "Already has alt text." };
  }

  if (!isDescribableAsset(asset)) {
    return { _id: assetId, status: "skipped", reason: `Cannot describe a ${asset.extension ?? "non-raster"} asset.` };
  }

  try {
    const altText = await generateAltText(sanityEditClient, {
      imageUrl: buildDescriptionSourceUrl(asset.url),
      filename: asset.filename ?? undefined,
      guidance,
    });

    if (!altText) {
      return { _id: assetId, status: "failed", reason: "Sanity AI returned an empty description." };
    }

    await sanityEditClient.patch(assetId).set({ altText }).commit();

    return { _id: assetId, status: "described", altText };
  } catch (error) {
    console.error(error);
    return { _id: assetId, status: "failed", reason: "Sanity AI could not describe this image." };
  }
}

async function readSettings() {
  const settings = await sanityEditClient.fetch<AltTextSettingsQueryResult>(AltTextSettingsQuery);

  return {
    enabled: settings?.enabled === true,
    guidance: settings?.guidance?.trim() ?? "",
  };
}

function clampBatchSize(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_BATCH_SIZE;
  }

  return Math.min(Math.max(Math.floor(value), 1), MAX_BATCH_SIZE);
}

/** Counts for the Studio backfill panel. */
export const GET: APIRoute = async ({ request }) => {
  const denied = await authorizeStudioRequest(request);

  if (denied) {
    return denied;
  }

  try {
    const stats = await sanityEditClient.fetch<AltTextStatsQueryResult>(AltTextStatsQuery);

    return privateJson({
      total: stats?.total ?? 0,
      missing: stats?.missing ?? 0,
      enabled: stats?.enabled === true,
    });
  } catch (error) {
    return internalErrorResponse(error, { error: "Failed to read alt text stats.", code: "internal_error" });
  }
};

/** Two callers: the Studio upload listener posts `{ _id }` and is toggle-gated; `{ backfill: true }` loops a batch and is always allowed. */
export const POST: APIRoute = async ({ request }) => {
  const denied = await authorizeStudioRequest(request);

  if (denied) {
    return denied;
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const force = body.force === true;

    if (body.backfill === true) {
      const { guidance } = await readSettings();
      const backlog = await sanityEditClient.fetch<AltTextBacklogQueryResult>(AltTextBacklogQuery, { force });
      const describable = backlog.filter((asset) => isDescribableAsset(asset));
      const batch = describable.slice(0, clampBatchSize(body.limit));

      const results: AltTextResult[] = [];

      // Sequential and abortable: Agent Actions are metered, and the panel's Stop aborts this request mid-batch.
      for (const asset of batch) {
        if (request.signal.aborted) {
          break;
        }

        results.push(await describeAsset(asset._id, guidance, force));
      }

      const described = results.filter((result) => result.status === "described").length;

      return privateJson({
        results,
        described,
        remaining: Math.max(describable.length - described, 0),
      });
    }

    const assetId = body._id;

    // Shape first, so a malformed id costs no Sanity read and never reaches the patch.
    if (!isImageAssetId(assetId)) {
      return apiErrorResponse(400, { error: "Expected an image asset `_id`, or `backfill: true`.", code: "missing_asset_id" });
    }

    const { enabled, guidance } = await readSettings();

    if (!enabled && !force) {
      return privateJson({ _id: assetId, status: "skipped", reason: "Automatic alt text is off." });
    }

    return privateJson(await describeAsset(assetId, guidance, force));
  } catch (error) {
    return internalErrorResponse(error, {
      error: "Alt text generation failed: Sanity could not be read. Try again in a moment.",
      code: "internal_error",
    });
  }
};
