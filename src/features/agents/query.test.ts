import assert from "node:assert/strict";
import { test } from "node:test";
import { SANITY_SINGLETON_SITE_SETTINGS_ID } from "~/sanity/constants";
import { AgentMarkdownServeQuery, AltTextSettingsQuery, AltTextStatsQuery } from "./query";

const SETTINGS_BY_ID = `*[_type == "${SANITY_SINGLETON_SITE_SETTINGS_ID}" && _id == "${SANITY_SINGLETON_SITE_SETTINGS_ID}"][0]`;

test("the serve query matches nothing while the site is locked, on its own fresh read", () => {
  assert.ok(AgentMarkdownServeQuery.includes(`&& ${SETTINGS_BY_ID}.basicAuth.siteWideEnabled != true`));
});

test("the alt-text queries read the settings singleton by id, so a second document of its type cannot stand in", () => {
  assert.ok(AltTextSettingsQuery.startsWith(`${SETTINGS_BY_ID}{`));
  assert.ok(AltTextStatsQuery.includes(`"enabled": ${SETTINGS_BY_ID}.altText.enabled`));
});
