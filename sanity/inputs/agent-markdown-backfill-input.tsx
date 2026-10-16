import { Button, Card, Flex, Spinner, Stack, Text } from "@sanity/ui";
import { useToast } from "@sanity/ui/toast";
import * as React from "react";
import { sanityConfig } from "../config";
import { useStudioFetch } from "../lib/studio-fetch";
import { readStudioJson, studioFailure } from "../lib/studio-response";

type Stats = {
  total: number;
  missing: number;
};

type BatchResult = {
  filled?: number;
  skipped?: number;
  remaining?: number;
  error?: string;
};

const pages = (count: number) => `${count} page${count === 1 ? "" : "s"}`;

/**
 * Fills the per-page agent Markdown everywhere it is still empty. Stores nothing on this document;
 * it loops batch requests because a large dataset can outlive one request's time budget.
 */
function AgentMarkdownBackfillInput() {
  const studioFetch = useStudioFetch();
  const toast = useToast();

  const [stats, setStats] = React.useState<Stats | null>(null);
  const [isRunning, setIsRunning] = React.useState(false);
  const [progress, setProgress] = React.useState<string | null>(null);
  const [isStopping, setIsStopping] = React.useState(false);
  const controllerRef = React.useRef<AbortController | null>(null);

  const loadStats = React.useCallback(async () => {
    try {
      const res = await studioFetch(sanityConfig.endpoints.generatePageMarkdown);
      const payload = await readStudioJson<Stats & { error?: string }>(res);

      if (!res.ok || !payload) {
        throw new Error(studioFailure(res, payload, "Could not read the pages."));
      }

      setStats({ total: payload.total, missing: payload.missing });
    } catch {
      setStats(null);
    }
  }, [studioFetch]);

  React.useEffect(() => {
    void loadStats();
  }, [loadStats]);

  // Leaving the document would orphan the loop with no Stop button left to press.
  React.useEffect(() => () => controllerRef.current?.abort(), []);

  const runBackfill = async () => {
    const controller = new AbortController();

    controllerRef.current = controller;
    setIsRunning(true);
    setIsStopping(false);
    setProgress("Starting...");

    let filled = 0;
    let skipped = 0;

    try {
      while (!controller.signal.aborted) {
        const res = await studioFetch(sanityConfig.endpoints.generatePageMarkdown, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ backfill: true }),
          signal: controller.signal,
        });

        const payload = await readStudioJson<BatchResult>(res);

        if (!res.ok || !payload) {
          throw new Error(studioFailure(res, payload, "Backfill failed."));
        }

        const batchFilled = payload.filled ?? 0;

        filled += batchFilled;
        skipped = payload.skipped ?? 0;
        setProgress(`Filled ${filled}, ${payload.remaining ?? 0} to go.`);

        // Empty pages stay in the backlog, so a batch that filled nothing means only those are left.
        if (!payload.remaining || batchFilled === 0) {
          break;
        }
      }

      const emptyNote = skipped > 0 ? ` ${pages(skipped)} have no content yet and were left empty.` : "";

      toast.push({
        status: "success",
        title: controller.signal.aborted ? "Backfill stopped" : "Backfill complete",
        description: `Agent Markdown written for ${pages(filled)}.${emptyNote}`,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        toast.push({
          status: "info",
          title: "Backfill stopped",
          description: "The batch in progress may still finish writing.",
        });

        return;
      }

      toast.push({
        status: "error",
        title: "Backfill failed",
        description: err instanceof Error ? err.message : "Unknown error.",
      });
    } finally {
      controllerRef.current = null;
      setIsRunning(false);
      setIsStopping(false);
      setProgress(null);
      void loadStats();
    }
  };

  const missing = stats?.missing ?? 0;

  let buttonLabel = missing > 0 ? `Backfill ${pages(missing)}` : "Nothing to backfill";

  if (isRunning) {
    buttonLabel = "Backfilling...";
  }

  return (
    <Card border padding={3} radius={2} tone="transparent">
      <Stack gap={4}>
        <Stack gap={3}>
          <Text size={1} weight="medium">
            Backfill missing agent Markdown
          </Text>
          <Text size={1} muted>
            Generates the Markdown for every page that serves it to agents but has none yet, from that page's current content. It
            is written to the published page, so it is served right away, and to any draft in progress. Existing Markdown is never
            overwritten, and pages with serving turned off are left alone.
          </Text>
        </Stack>

        <Flex align="center" gap={3}>
          <Button text={buttonLabel} tone="primary" disabled={isRunning || missing === 0} onClick={() => void runBackfill()} />

          {isRunning ? (
            <Button
              text={isStopping ? "Stopping..." : "Stop"}
              mode="ghost"
              disabled={isStopping}
              onClick={() => {
                setIsStopping(true);
                controllerRef.current?.abort();
              }}
            />
          ) : null}

          {isRunning ? (
            <Flex align="center" gap={2}>
              <Spinner muted />
              <Text size={1} muted>
                {progress}
              </Text>
            </Flex>
          ) : null}

          {!isRunning && stats ? (
            <Text size={1} muted>
              {missing} of {stats.total} pages without agent Markdown.
            </Text>
          ) : null}
        </Flex>
      </Stack>
    </Card>
  );
}

export { AgentMarkdownBackfillInput };
