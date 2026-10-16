import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { createProxySanityState, type ProxyStateDeps } from "~/features/sanity/proxy-state";
import {
  AGENT_MARKDOWN_STATE_QUERY,
  type AgentMarkdownPayload,
  isAgentMarkdownEligible,
  toAgentMarkdownState,
} from "./markdown-eligibility";

const ENV = { projectId: "p", dataset: "d", apiVersion: "2025-01-01", token: "t" };

const OPEN: AgentMarkdownPayload = { siteLocked: false, routes: [{ uri: "/about", excluded: false, gated: false }] };
const LOCKED: AgentMarkdownPayload = { ...OPEN, siteLocked: true };

function agentMarkdownState(t: TestContext, deps: ProxyStateDeps) {
  let published = OPEN;

  t.mock.method(globalThis, "fetch", async () => Response.json({ result: published }));

  return {
    getState: createProxySanityState(AGENT_MARKDOWN_STATE_QUERY, toAgentMarkdownState, ENV, deps),
    publish: (payload: AgentMarkdownPayload) => {
      published = payload;
    },
  };
}

test("publishing Protect entire site stops agent Markdown on the next request, inside the hot cache TTL", async (t) => {
  let version = "v1";
  const { getState, publish } = agentMarkdownState(t, { version: async () => version });

  assert.equal(isAgentMarkdownEligible(await getState(), "/about"), true);

  publish(LOCKED);
  version = "v2";

  assert.equal(isAgentMarkdownEligible(await getState(), "/about"), false);
});

test("without the version tie the lock waits out the TTL, which is the gap the tie closes", async (t) => {
  const { getState, publish } = agentMarkdownState(t, {});

  await getState();
  publish(LOCKED);

  assert.equal(isAgentMarkdownEligible(await getState(), "/about"), true);
});

test("the deployed snapshot is tied to the content version, as the Basic Auth state is", () => {
  const source = readFileSync(join(import.meta.dirname, "markdown-proxy-state.ts"), "utf8");

  assert.match(source, /\{ version: \(\) => contentVersion\.read\(\) \}/);
});
