import assert from "node:assert/strict";
import { test } from "node:test";
import { escapeXml } from "./xml";

test("escapeXml escapes the five XML special characters", () => {
  assert.equal(escapeXml(`/q&a <b> "c" 'd'`), "/q&amp;a &lt;b&gt; &quot;c&quot; &apos;d&apos;");
});

test("escapeXml treats its input as text, so an entity-looking string is escaped too", () => {
  assert.equal(escapeXml("&amp;"), "&amp;amp;");
});
