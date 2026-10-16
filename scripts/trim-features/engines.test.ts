import assert from "node:assert/strict";
import { test } from "node:test";
import { findEngineMismatches, formatEngineHint, satisfies } from "./engines";

test("satisfies reads the caret, tilde, comparison and exact forms package.json uses", () => {
  assert.ok(satisfies("v24.15.0", "^24.15.0"));
  assert.ok(satisfies("24.20.1", "^24.15.0"));
  assert.ok(!satisfies("v24.11.0", "^24.15.0"));
  assert.ok(!satisfies("25.0.0", "^24.15.0"));
  assert.ok(satisfies("11.6.2", ">=11.6.2"));
  assert.ok(!satisfies("11.6.1", ">=11.6.2"));
  assert.ok(satisfies("24.15.9", "~24.15.0"));
  assert.ok(!satisfies("24.16.0", "~24.15.0"));
  assert.ok(satisfies("24.15.0", "24.15.0"));
  assert.ok(!satisfies("24.15.1", "24.15.0"));
  assert.ok(satisfies("24.3.0", "24"));
  assert.ok(satisfies("22.1.0", ">=20 <23"));
  assert.ok(!satisfies("23.0.0", ">=20 <23"));
  assert.ok(satisfies("0.2.5", "^0.2.0"));
  assert.ok(!satisfies("0.3.0", "^0.2.0"));
});

test("satisfies takes any alternative of an || range", () => {
  assert.ok(satisfies("22.12.0", "^20.19.0 || ^22.12.0 || >=24"));
  assert.ok(!satisfies("21.0.0", "^20.19.0 || ^22.12.0 || >=24"));
});

test("satisfies never blocks on syntax it does not read", () => {
  assert.ok(satisfies("1.0.0", "1.2.3 - 2.3.4"));
  assert.ok(satisfies("1.0.0", "latest"));
  assert.ok(satisfies("not a version", "^24.15.0"));
});

test("findEngineMismatches names each tool outside its range, and skips an npm it could not read", () => {
  const engines = { node: "^24.15.0", npm: ">=11.6.2" };

  assert.deepEqual(findEngineMismatches(engines, { node: "v24.11.0", npm: "11.6.1" }), [
    { tool: "node", have: "24.11.0", want: "^24.15.0" },
    { tool: "npm", have: "11.6.1", want: ">=11.6.2" },
  ]);
  assert.deepEqual(findEngineMismatches(engines, { node: "v24.15.0" }), []);
  assert.deepEqual(findEngineMismatches(undefined, { node: "v10.0.0", npm: "1.0.0" }), []);
});

test("formatEngineHint points at nvm when .nvmrc pins the version", () => {
  const lines = formatEngineHint([{ tool: "node", have: "24.11.0", want: "^24.15.0" }], "24.15.0").join("\n");

  assert.match(lines, /runs node 24\.11\.0; package\.json requires \^24\.15\.0/);
  assert.match(lines, /`nvm use` \(\.nvmrc pins 24\.15\.0\)/);
});
