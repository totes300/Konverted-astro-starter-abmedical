/**
 * The toolchain `package.json` pins, checked before the trim writes anything. With `engine-strict`,
 * `npm install` under the wrong Node fails after the files are already gone, so this asks first.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type EngineMismatch = { tool: "node" | "npm"; have: string; want: string };

type Version = [number, number, number];

function parseVersion(value: string): Version | undefined {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(value.trim());

  if (!match) {
    return undefined;
  }

  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compare(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** How many leading parts a partial version names: `24` is 1, `24.15` is 2, `24.15.0` is 3. */
function precision(value: string): number {
  return value
    .replace(/^v/, "")
    .split(".")
    .filter((part) => /^\d+$/.test(part)).length;
}

/** The exclusive upper bound of a partial version: `24` is below 25, `24.15` below 24.16. */
function nextAfter(version: Version, parts: number): Version {
  if (parts <= 1) {
    return [version[0] + 1, 0, 0];
  }

  return parts === 2 ? [version[0], version[1] + 1, 0] : [version[0], version[1], version[2] + 1];
}

/** One comparator against a version. `undefined` when the syntax is not one this reads. */
function matchesComparator(have: Version, comparator: string): boolean | undefined {
  if (comparator === "" || comparator === "*" || comparator === "x") {
    return true;
  }

  const match = /^(\^|~|>=|<=|>|<|=)?\s*v?(\d+(?:\.\d+){0,2})$/.exec(comparator);

  if (!match) {
    return undefined;
  }

  const [, operator = "", raw = ""] = match;
  const want = parseVersion(raw);

  if (!want) {
    return undefined;
  }

  const order = compare(have, want);

  switch (operator) {
    case ">=":
      return order >= 0;
    case ">":
      return order > 0;
    case "<=":
      return order <= 0;
    case "<":
      return order < 0;
    case "^": {
      const ceiling: Version = want[0] > 0 ? [want[0] + 1, 0, 0] : want[1] > 0 ? [0, want[1] + 1, 0] : [0, 0, want[2] + 1];

      return order >= 0 && compare(have, ceiling) < 0;
    }
    case "~":
      return order >= 0 && compare(have, nextAfter(want, Math.min(precision(raw), 2))) < 0;
    default:
      return order >= 0 && compare(have, nextAfter(want, precision(raw))) < 0;
  }
}

/**
 * Whether `version` satisfies an `engines` range: `||` alternatives of space-separated comparators,
 * the subset of semver `package.json` files actually use. Syntax this does not read counts as
 * satisfied, so an unusual range never blocks a trim on a guess.
 */
export function satisfies(version: string, range: string): boolean {
  const have = parseVersion(version);

  if (!have) {
    return true;
  }

  return range.split("||").some((alternative) => {
    // A hyphen range (`1.2.3 - 2.3.4`) is the one common form this does not read.
    if (/\s-\s/.test(alternative)) {
      return true;
    }

    const comparators = alternative
      .trim()
      .replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1")
      .split(/\s+/);

    return comparators.every((comparator) => matchesComparator(have, comparator) ?? true);
  });
}

export function findEngineMismatches(
  engines: Record<string, string> | undefined,
  have: { node: string; npm?: string }
): EngineMismatch[] {
  const mismatches: EngineMismatch[] = [];

  if (engines?.node && !satisfies(have.node, engines.node)) {
    mismatches.push({ tool: "node", have: have.node.replace(/^v/, ""), want: engines.node });
  }

  if (engines?.npm && have.npm && !satisfies(have.npm, engines.npm)) {
    mismatches.push({ tool: "npm", have: have.npm, want: engines.npm });
  }

  return mismatches;
}

/** What to type to fix it: `nvm use` when `.nvmrc` pins a version, then the npm the range asks for. */
export function formatEngineHint(mismatches: readonly EngineMismatch[], nvmrc?: string): string[] {
  const lines = mismatches.map(({ tool, have, want }) => `This shell runs ${tool} ${have}; package.json requires ${want}.`);
  const node = mismatches.find((entry) => entry.tool === "node");
  const npm = mismatches.find((entry) => entry.tool === "npm");

  if (node) {
    lines.push(
      nvmrc ? `Run \`nvm use\` (.nvmrc pins ${nvmrc}), then run the trim again.` : `Switch to a Node that matches ${node.want}.`
    );
  }

  if (npm) {
    lines.push(
      node
        ? `If npm is still outside ${npm.want} after that, run \`npm install -g npm@"${npm.want}"\`.`
        : `Run \`npm install -g npm@"${npm.want}"\`, or switch to a Node release that bundles it.`
    );
  }

  return lines;
}

/** The npm running this script: `npm run` says so in its user agent, otherwise ask it. */
function npmVersion(): string | undefined {
  const agent = /\bnpm\/(\S+)/.exec(process.env.npm_config_user_agent ?? "");

  if (agent?.[1]) {
    return agent[1];
  }

  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["-v"], { encoding: "utf8" });

  return result.status === 0 ? result.stdout.trim() : undefined;
}

/** Mismatches between this shell and `package.json`'s `engines`, plus the hint to fix them. */
export function checkEngines(root: string): { mismatches: EngineMismatch[]; hint: string[] } {
  let engines: Record<string, string> | undefined;

  try {
    engines = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { engines?: Record<string, string> }).engines;
  } catch {
    return { mismatches: [], hint: [] };
  }

  const nvmrcPath = join(root, ".nvmrc");
  const nvmrc = existsSync(nvmrcPath) ? readFileSync(nvmrcPath, "utf8").trim() || undefined : undefined;
  const mismatches = findEngineMismatches(engines, { node: process.version, npm: npmVersion() });

  return { mismatches, hint: formatEngineHint(mismatches, nvmrc) };
}
