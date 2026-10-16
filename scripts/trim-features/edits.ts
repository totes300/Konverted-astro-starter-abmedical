/**
 * Pure source transforms for the feature trim.
 *
 * The registries a feature has to be unwired from (`sanity/schemas/index.ts`,
 * `sanity/schemas/page-sections/index.ts`, `sanity/constants.ts`, `features/page-builder/page-sections.tsx`)
 * are enumerations with `// PLOP: Add …` markers: this file is the inverse of `plopfile.mjs`.
 * Regex surgery over them is fragile, so every transform walks the TypeScript AST and returns exact
 * character ranges instead.
 *
 * Nothing here touches the filesystem. `applyEdits` takes a source string and a list of edits,
 * collects the ranges, and asserts that every matcher hit **exactly once**. A repo that has drifted
 * away from the manifest therefore throws before a single byte is written, rather than being left
 * half-trimmed.
 */

import ts from "typescript";

/** One declarative removal. `describe` renders it in the plan; the kind picks the AST walk. */
export type Edit =
  | { kind: "dropImport"; id: string }
  | { kind: "dropExport"; id: string }
  | { kind: "dropArrayElement"; arrayName: string; id: string }
  | { kind: "dropObjectProperty"; anchor: string; key: string }
  | { kind: "dropVariableStatement"; name: string }
  | { kind: "dropCallInArray"; anchor: string; title: string }
  | { kind: "dropStringFromArray"; anchor: string; value: string; count?: number }
  | { kind: "dropObjectFromArray"; anchor: string; property: string; value: string }
  | { kind: "dropFieldByName"; anchor: string; name: string }
  | { kind: "dropCallStatement"; fn: string; titleContains: string; count?: number }
  | { kind: "dropUnionMember"; anchor: string; value: string }
  | { kind: "dropSwitchCase"; value: string }
  | { kind: "dropJsonKey"; key: string; in?: string }
  | { kind: "dropLines"; contains: string; count?: number; every?: true; optional?: boolean }
  | { kind: "dropBlock"; opens: string }
  | { kind: "replaceText"; find: string; with: string; label?: string; count?: number; optional?: boolean };

/**
 * A file plus the edits to apply to it. `optional` files are skipped when they do not exist.
 *
 * `requires` names a path these edits only make sense beside: a project on an older cut of this
 * starter may never have had the thing they unwire, and a literal matcher cannot tell "never here"
 * from "here in a shape I cannot read". Absent, the whole group is skipped rather than reported.
 */
export type FileEdits = { file: string; edits: Edit[]; optional?: boolean; requires?: string };

/** Every binding a batch of edits removes, so one clause losing all of its names loses the statement. */
function droppedImportIds(edits: Edit[]): ReadonlySet<string> {
  return new Set(edits.flatMap((edit) => (edit.kind === "dropImport" ? [edit.id] : [])));
}

/** The same for `export { … }` clauses: two features each dropping one name must not leave `export {}`. */
function droppedIds(edits: Edit[]): ReadonlySet<string> {
  return new Set([...droppedImportIds(edits), ...edits.flatMap((edit) => (edit.kind === "dropExport" ? [edit.id] : []))]);
}

/** Half-open `[start, end)` slice of the source to delete, or to replace when `text` is set. */
type Range = { start: number; end: number; text?: string };

/** Thrown when a matcher did not hit exactly once, so the caller can abort the whole run. */
export class EditMatchError extends Error {
  constructor(
    readonly edit: Edit,
    readonly matches: number,
    readonly file?: string
  ) {
    super(
      `${describeEdit(edit)} matched ${matches} time${matches === 1 ? "" : "s"}, expected exactly 1${file ? ` in ${file}` : ""}.`
    );
    this.name = "EditMatchError";
  }
}

/**
 * Whether a matcher finding nothing means the work is already done.
 *
 * Every structural kind names one specific thing: a binding, an array element, an object key, a
 * declaration. If it is not there, the desired end state has been reached — by an earlier run, or
 * because this project never wrote it that way. A registry that inlines its imports has no
 * `import { MediaSection }` to remove, and removing the registry entry takes the inline import with
 * it, so insisting on the import would report a no-op as work left undone.
 *
 * The text matchers are the exception. `dropLines` and `replaceText` match a span rather than a
 * name, so finding nothing is genuinely ambiguous: the span may be absent, or it may be present in a
 * form this cannot recognise. Those still need a human.
 *
 * `optional` exempts a cosmetic span, in practice the comment above a branch going elsewhere, so a
 * reword cannot stop a trim.
 *
 * Two or more matches is never satisfied, whatever the kind: that is an ambiguous anchor.
 */
export function isSatisfiedWhenAbsent(edit: Edit): boolean {
  if (edit.kind === "dropLines" || edit.kind === "replaceText") {
    return edit.optional === true;
  }

  // A block is named by its opener, so like a structural kind, an absent opener is a removed block.
  return true;
}

/** Human-readable one-liner for the plan output and for error messages. */
export function describeEdit(edit: Edit): string {
  switch (edit.kind) {
    case "dropImport":
      return `remove the import of \`${edit.id}\``;
    case "dropExport":
      return `remove the export of \`${edit.id}\``;
    case "dropArrayElement":
      return `remove \`${edit.id}\` from \`${edit.arrayName}\``;
    case "dropObjectProperty":
      return `remove \`${edit.key}\` from \`${edit.anchor}\``;
    case "dropVariableStatement":
      return `remove \`${edit.name}\``;
    case "dropCallInArray":
      return `remove the \`${edit.title}\` item from \`${edit.anchor}\``;
    case "dropStringFromArray":
      return `remove "${edit.value}" from \`${edit.anchor}\``;
    case "dropObjectFromArray":
      return `remove \`{ ${edit.property}: "${edit.value}" }\` from \`${edit.anchor}\``;
    case "dropFieldByName":
      return `remove the \`${edit.name}\` field from \`${edit.anchor}\``;
    case "dropCallStatement":
      return `remove the \`${edit.fn}\` block${(edit.count ?? 1) === 1 ? "" : "s"} naming "${edit.titleContains}"`;
    case "dropUnionMember":
      return `remove "${edit.value}" from the \`${edit.anchor}\` union`;
    case "dropSwitchCase":
      return `remove the \`case "${edit.value}"\` clause`;
    case "dropJsonKey":
      return `remove the "${edit.key}" key${edit.in ? ` from "${edit.in}"` : ""}`;
    case "dropLines":
      return edit.every
        ? `remove every line containing "${edit.contains}"`
        : `remove the line${(edit.count ?? 1) === 1 ? "" : "s"} containing "${edit.contains}"`;
    case "dropBlock":
      return `remove the block opened by "${edit.opens}"`;
    case "replaceText":
      return (
        edit.label ??
        (edit.with === "" ? `remove the block starting "${firstLine(edit.find)}"` : `rewrite "${firstLine(edit.find)}"`)
      );
  }
}

/** First line of a multi-line matcher, for readable plan output. */
function firstLine(value: string): string {
  const [line = ""] = value.trim().split("\n");

  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

/**
 * A component's TypeScript lives between the two `---` fences, so it is extracted, transformed as
 * TypeScript, and spliced back at the same offsets. A file with no frontmatter is plain TypeScript.
 */
function splitFrontmatter(source: string): { prefix: string; code: string } {
  if (!source.startsWith("---")) {
    return { prefix: "", code: source };
  }

  const open = source.indexOf("\n");
  const close = source.indexOf("\n---", open);

  if (open === -1 || close === -1) {
    return { prefix: "", code: source };
  }

  return { prefix: source.slice(0, open + 1), code: source.slice(open + 1, close + 1) };
}

/**
 * The frontmatter, parsed, plus where it starts in the whole file.
 *
 * The AST transforms only ever see the frontmatter, so a class name in the template that happens to
 * match a removed key is never touched. Their ranges are shifted by `offset` so every range in a run
 * is relative to the same string. The literal matchers (`replaceText`, `dropLines`) run over the
 * whole file instead, because markup is where a component puts the conditional a removal collapses.
 */
function split(source: string, fileName: string): { offset: number; code: string; parsed: ts.SourceFile } {
  const isComponent = fileName.endsWith(".astro");
  const { prefix, code } = isComponent ? splitFrontmatter(source) : { prefix: "", code: source };

  return { offset: prefix.length, code, parsed: parse(code, isComponent ? `${fileName}.ts` : fileName) };
}

/** Whether an edit is matched as literal text over the whole file rather than over the AST. */
function isTextMatcher(edit: Edit): boolean {
  return edit.kind === "dropLines" || edit.kind === "replaceText" || edit.kind === "dropBlock";
}

/** Ranges for one edit, always relative to the whole `source`. */
function rangesFor(
  edit: Edit,
  source: string,
  parts: { offset: number; code: string; parsed: ts.SourceFile },
  alsoDropped: ReadonlySet<string> = new Set()
): Range[] {
  if (isTextMatcher(edit)) {
    return collectRanges(edit, source, parts.parsed, alsoDropped);
  }

  return collectRanges(edit, parts.code, parts.parsed, alsoDropped).map((range) => ({
    ...range,
    start: range.start + parts.offset,
    end: range.end + parts.offset,
  }));
}

function parse(code: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** Walks back over the horizontal whitespace immediately before `index`. */
function backOverIndent(source: string, index: number): number {
  let from = index;

  while (from > 0 && (source[from - 1] === " " || source[from - 1] === "\t")) {
    from -= 1;
  }

  return from;
}

/**
 * Extends a list entry's range so the surrounding punctuation goes with it.
 *
 * An entry that owns its line takes the leading indentation and the trailing `,` and newline, so no
 * blank indented line is left behind. An entry written inline takes its trailing `, ` instead, or,
 * when it is the last one, the `, ` in front of it. Either way the surviving entries stay a
 * well-formed comma-separated list rather than something `npm run format` has to guess at.
 */
function expandToWholeLines(source: string, start: number, end: number): Range {
  let to = end;
  const hasTrailingComma = source[to] === ",";

  if (hasTrailingComma) {
    to += 1;
  }

  while (source[to] === " " || source[to] === "\t") {
    to += 1;
  }

  if (source[to] === "\r") {
    to += 1;
  }

  if (source[to] === "\n") {
    return { start: backOverIndent(source, start), end: to + 1 };
  }

  if (hasTrailingComma) {
    return { start, end: to };
  }

  // Last entry on its line: the comma in front of it would otherwise dangle.
  const from = backOverIndent(source, start);

  return { start: source[from - 1] === "," ? from - 1 : start, end };
}

/** Node range including any JSDoc or `//` comment written directly above it. */
function rangeWithLeadingComments(node: ts.Node, source: string): Range {
  const start = node.getFullStart();
  const trivia = source.slice(start, node.getStart());
  // Keep the blank line that separated this statement from the previous one.
  const offset = trivia.match(/^\s*\n/)?.[0]?.length ?? 0;

  return { start: start + offset, end: node.getEnd() };
}

/** The name a call is made through: `items(…)` and `S.list().items(…)` both answer `items`. */
function calleeName(node: ts.CallExpression): string | undefined {
  const callee = node.expression;

  if (ts.isIdentifier(callee)) {
    return callee.text;
  }

  return ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
}

/**
 * Every array literal reachable through `anchor`: assigned to it (`const x = [...]`), named by it
 * (`x: [...]`), or passed to a call of that name (`S.list().items([...])`, which is how the
 * structure builder is written).
 */
/** Past `as const` and `satisfies`: missing either makes the whole registry invisible to a matcher. */
function unwrapInitializer(node: ts.Expression): ts.Expression {
  let current = node;

  while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }

  return current;
}

function findArraysNamed(file: ts.SourceFile, anchor: string): ts.ArrayLiteralExpression[] {
  const found: ts.ArrayLiteralExpression[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === anchor && node.initializer) {
      const initializer = unwrapInitializer(node.initializer);

      if (ts.isArrayLiteralExpression(initializer)) {
        found.push(initializer);
      }
    }

    if (ts.isPropertyAssignment(node) && propertyName(node.name) === anchor && ts.isArrayLiteralExpression(node.initializer)) {
      found.push(node.initializer);
    }

    if (ts.isCallExpression(node) && calleeName(node) === anchor) {
      for (const argument of node.arguments) {
        if (ts.isArrayLiteralExpression(argument)) {
          found.push(argument);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(file);

  return found;
}

/** Every object literal assigned to, or named by, `anchor`. */
function findObjectsNamed(file: ts.SourceFile, anchor: string): ts.ObjectLiteralExpression[] {
  const found: ts.ObjectLiteralExpression[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === anchor && node.initializer) {
      const initializer = unwrapInitializer(node.initializer);

      if (ts.isObjectLiteralExpression(initializer)) {
        found.push(initializer);
      }
    }

    if (ts.isPropertyAssignment(node) && propertyName(node.name) === anchor && ts.isObjectLiteralExpression(node.initializer)) {
      found.push(node.initializer);
    }

    ts.forEachChild(node, visit);
  };

  visit(file);

  return found;
}

/**
 * The written name of a property key. Covers the identifier, string and computed-member forms these
 * registries use: `blog:`, `"blog":` and `[SINGLETON_IDS.blog]:` all answer `blog`.
 */
function propertyName(name: ts.PropertyName | undefined): string | undefined {
  if (!name) {
    return undefined;
  }

  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  if (ts.isComputedPropertyName(name)) {
    const expression = name.expression;

    if (ts.isPropertyAccessExpression(expression)) {
      return expression.name.text;
    }

    if (ts.isIdentifier(expression) || ts.isStringLiteral(expression)) {
      return expression.text;
    }
  }

  return undefined;
}

/**
 * `S.listItem().title("Blog")…` reduced to the argument of its `.title()` call. The structure
 * builder is one long call chain, so the title is the only stable handle on which item is which.
 */
function chainTitle(node: ts.Expression): string | undefined {
  let current: ts.Node = node;

  while (ts.isCallExpression(current)) {
    const callee = current.expression;

    if (ts.isPropertyAccessExpression(callee) && callee.name.text === "title") {
      const [argument] = current.arguments;

      if (argument && ts.isStringLiteral(argument)) {
        return argument.text;
      }
    }

    current = ts.isPropertyAccessExpression(callee) ? callee.expression : callee;
  }

  return undefined;
}

/** `S.divider()`: a structure item with no title, so `chainTitle` never matches it. */
function isDividerCall(node: ts.Expression): boolean {
  return ts.isCallExpression(node) && calleeName(node) === "divider";
}

/** Neighbouring array items as one whole-line cut, taking one of the blank lines around it so two never pile up. */
function blockRange(first: ts.Expression, last: ts.Expression, code: string): Range {
  const { start } = rangeWithLeadingComments(first, code);
  const range = expandToWholeLines(code, start, last.getEnd());

  if (!/\n[ \t]*\n$/.test(code.slice(0, range.start))) {
    return range;
  }

  const blankAfter = code.slice(range.end).match(/^[ \t]*\r?\n/)?.[0];

  if (blankAfter) {
    return { start: range.start, end: range.end + blankAfter.length };
  }

  const blankBefore = code.slice(0, range.start).match(/\n([ \t]*\r?\n)$/)?.[1] ?? "";

  return { start: range.start - blankBefore.length, end: range.end };
}

/**
 * Re-cuts every array a `dropCallInArray` edit touches: the dropped items plus the dividers they
 * strand (first, last, or straight after another), each run of neighbours as one block. Arrays that
 * lose nothing are left alone. The cuts cover the per-edit ranges, which merge into them.
 */
function droppedItemBlockRanges(edits: Edit[], code: string, file: ts.SourceFile): Range[] {
  const drops = edits.flatMap((edit) => (edit.kind === "dropCallInArray" ? [edit] : []));
  const visited = new Set<ts.ArrayLiteralExpression>();
  const ranges: Range[] = [];

  for (const anchor of new Set(drops.map((edit) => edit.anchor))) {
    const titles = new Set(drops.filter((edit) => edit.anchor === anchor).map((edit) => edit.title));

    for (const array of findArraysNamed(file, anchor)) {
      if (visited.has(array)) {
        continue;
      }

      visited.add(array);

      const removed = new Set(array.elements.filter((element) => titles.has(chainTitle(element) ?? "")));

      if (removed.size === 0) {
        continue;
      }

      const survivors: ts.Expression[] = [];

      for (const element of array.elements) {
        if (removed.has(element)) {
          continue;
        }

        const previous = survivors.at(-1);

        if (isDividerCall(element) && (previous === undefined || isDividerCall(previous))) {
          removed.add(element);
          continue;
        }

        survivors.push(element);
      }

      for (let last = survivors.at(-1); last && isDividerCall(last); last = survivors.at(-1)) {
        survivors.pop();
        removed.add(last);
      }

      let run: ts.Expression[] = [];

      for (const element of [...array.elements, undefined]) {
        if (element && removed.has(element)) {
          run.push(element);
          continue;
        }

        const [first] = run;
        const last = run.at(-1);

        if (first && last) {
          ranges.push(blockRange(first, last, code));
        }

        run = [];
      }
    }
  }

  return ranges;
}

function collectRanges(edit: Edit, code: string, file: ts.SourceFile, alsoDropped: ReadonlySet<string> = new Set()): Range[] {
  switch (edit.kind) {
    case "dropImport":
      return dropImportRanges(edit.id, code, file, alsoDropped);
    case "dropExport":
      return dropExportRanges(edit.id, code, file, alsoDropped);
    case "dropArrayElement":
      // A bare entry (`article`) or a call to it (`muxInput({ … })`), which is how plugin lists are written.
      return findArraysNamed(file, edit.arrayName).flatMap((array) =>
        array.elements
          .filter(
            (element) =>
              (ts.isIdentifier(element) && element.text === edit.id) ||
              (ts.isCallExpression(element) && ts.isIdentifier(element.expression) && element.expression.text === edit.id)
          )
          .map((element) => {
            const start = ts.isCallExpression(element) ? rangeWithLeadingComments(element, code).start : element.getStart();
            return expandToWholeLines(code, start, element.getEnd());
          })
      );
    case "dropObjectProperty":
      return findObjectsNamed(file, edit.anchor).flatMap((object) =>
        object.properties
          .filter((property) => propertyName(property.name) === edit.key)
          .map((property) => {
            const { start } = rangeWithLeadingComments(property, code);
            return expandToWholeLines(code, start, property.getEnd());
          })
      );
    case "dropVariableStatement":
      return dropVariableStatementRanges(edit.name, code, file);
    case "dropCallInArray":
      return findArraysNamed(file, edit.anchor).flatMap((array) =>
        array.elements
          .filter((element) => chainTitle(element) === edit.title)
          .map((element) => {
            const { start } = rangeWithLeadingComments(element, code);
            return expandToWholeLines(code, start, element.getEnd());
          })
      );
    case "dropStringFromArray":
      return findArraysNamed(file, edit.anchor).flatMap((array) =>
        array.elements
          .filter((element) => ts.isStringLiteral(element) && element.text === edit.value)
          .map((element) => expandToWholeLines(code, element.getStart(), element.getEnd()))
      );
    case "dropObjectFromArray":
      return findArraysNamed(file, edit.anchor).flatMap((array) =>
        array.elements
          .filter((element) => {
            if (!ts.isObjectLiteralExpression(element)) {
              return false;
            }

            return element.properties.some(
              (property) =>
                propertyName(property.name) === edit.property &&
                ts.isPropertyAssignment(property) &&
                ts.isStringLiteral(property.initializer) &&
                property.initializer.text === edit.value
            );
          })
          .map((element) => expandToWholeLines(code, element.getStart(), element.getEnd()))
      );
    case "dropFieldByName":
      return findArraysNamed(file, edit.anchor).flatMap((array) =>
        array.elements
          .filter((element) => definedFieldName(element) === edit.name)
          .map((element) => {
            const { start } = rangeWithLeadingComments(element, code);
            return expandToWholeLines(code, start, element.getEnd());
          })
      );
    case "dropCallStatement":
      return dropCallStatementRanges(edit.fn, edit.titleContains, code, file);
    case "dropUnionMember":
      return dropUnionMemberRanges(edit.anchor, edit.value, file);
    case "dropSwitchCase":
      return dropSwitchCaseRanges(edit.value, code, file);
    case "dropJsonKey":
      return jsonKeyRanges(edit.key, code, edit.in);
    case "dropLines":
      return dropLineRanges(edit.contains, code);
    case "dropBlock":
      return dropBlockRanges(edit.opens, code);
    case "replaceText":
      // Replacing with nothing is a deletion, so it can merge with another deletion inside it.
      return findTextRanges(edit.find, code).map((range) => (edit.with === "" ? range : { ...range, text: edit.with }));
  }
}

/**
 * One key out of a JSON object, or out of the object under `parent` (`scripts` in `package.json`),
 * rewritten whole: cutting the last key's line dangles a comma.
 */
function jsonKeyRanges(key: string, code: string, parent?: string): Range[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(code);
  } catch {
    return [];
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return [];
  }

  const root = parsed as Record<string, unknown>;
  const target = parent === undefined ? root : root[parent];

  if (typeof target !== "object" || target === null || Array.isArray(target) || !Object.hasOwn(target, key)) {
    return [];
  }

  const kept = Object.fromEntries(Object.entries(target).filter(([name]) => name !== key));
  const result = parent === undefined ? kept : { ...root, [parent]: kept };

  return [{ start: 0, end: code.length, text: `${JSON.stringify(result, null, 2)}\n` }];
}

/**
 * A top-level `fn("<title>", …);` statement whose first string argument contains `titleContains`.
 * Written for the colocated `test("…", () => {…})` blocks that cover a function being removed.
 */
function dropCallStatementRanges(fn: string, titleContains: string, code: string, file: ts.SourceFile): Range[] {
  const ranges: Range[] = [];

  for (const statement of file.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
      continue;
    }

    const call = statement.expression;

    if (calleeName(call) !== fn) {
      continue;
    }

    const [title] = call.arguments;

    if (!title || !ts.isStringLiteral(title) || !title.text.includes(titleContains)) {
      continue;
    }

    const { start } = rangeWithLeadingComments(statement, code);
    let end = statement.getEnd();

    if (code[end] === "\n") {
      end += 1;
    }

    ranges.push({ start, end });
  }

  return ranges;
}

/**
 * Occurrences of `find`, matched with any run of whitespace standing in for any other.
 *
 * The escape hatch for GROQ, which has no AST here. Matching whitespace exactly made these the most
 * fragile part of the manifest: reflowing a type list across several lines, re-indenting a block, or
 * running a formatter over it would all break an anchor without changing a thing about what the
 * query means. Collapsing whitespace costs nothing in precision, because the surrounding tokens are
 * what identify the span, and `applyEdits` still refuses anything that matches more than once.
 */
function findTextRanges(find: string, code: string): Range[] {
  const pattern = find
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");

  const ranges: Range[] = [];
  const regex = new RegExp(pattern, "g");
  let match = regex.exec(code);

  while (match !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
    match = regex.exec(code);
  }

  return ranges;
}

/** One name out of an `export { … }` clause, or the whole statement when nothing in it survives the batch. */
function dropExportRanges(id: string, code: string, file: ts.SourceFile, alsoDropped: ReadonlySet<string>): Range[] {
  const ranges: Range[] = [];

  for (const statement of file.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
      continue;
    }

    const { elements } = statement.exportClause;
    const matching = elements.filter((element) => element.name.text === id);

    if (matching.length === 0) {
      continue;
    }

    if (elements.every((element) => element.name.text === id || alsoDropped.has(element.name.text))) {
      ranges.push(expandToWholeLines(code, rangeWithLeadingComments(statement, code).start, statement.getEnd()));
      continue;
    }

    for (const element of matching) {
      ranges.push(expandToWholeLines(code, element.getStart(), element.getEnd()));
    }
  }

  return ranges;
}

/**
 * The whole `import` statement when nothing it binds survives, or just that specifier when the
 * clause names others that do. A default or namespace import is removed with its statement.
 *
 * `alsoDropped` is the rest of the batch: judging it one edit at a time left `import {} from "…"`.
 */
function dropImportRanges(id: string, code: string, file: ts.SourceFile, alsoDropped: ReadonlySet<string>): Range[] {
  const ranges: Range[] = [];

  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) {
      continue;
    }

    const clause = statement.importClause;
    const bindings = clause.namedBindings;

    if (clause.name?.text === id || (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === id)) {
      ranges.push(expandToWholeLines(code, rangeWithLeadingComments(statement, code).start, statement.getEnd()));
      continue;
    }

    if (!bindings || !ts.isNamedImports(bindings)) {
      continue;
    }

    const matching = bindings.elements.filter((element) => element.name.text === id);

    if (matching.length === 0) {
      continue;
    }

    // Nothing in the clause survives, so the statement itself has nothing left to import.
    if (!clause.name && bindings.elements.every((element) => element.name.text === id || alsoDropped.has(element.name.text))) {
      ranges.push(expandToWholeLines(code, rangeWithLeadingComments(statement, code).start, statement.getEnd()));
      continue;
    }

    for (const element of matching) {
      const start = element.getStart();
      let end = element.getEnd();

      // Take the following `, ` when there is one, otherwise the preceding one, so the surviving
      // specifiers stay comma-separated either way.
      if (code[end] === ",") {
        end += 1;

        while (code[end] === " ") {
          end += 1;
        }

        ranges.push({ start, end });
        continue;
      }

      let from = start;

      while (from > 0 && code[from - 1] === " ") {
        from -= 1;
      }

      if (code[from - 1] === ",") {
        from -= 1;
      }

      ranges.push({ start: from, end });
    }
  }

  return ranges;
}

/**
 * The `name` of a `defineField({ name: "x", … })` element, or undefined for anything else.
 *
 * Sanity schemas are arrays of these calls, and a field's `name` is the one part of it that cannot
 * change without changing the content model. Matching on it means the rest of the definition, which
 * is exactly what a project customizes, can be rewritten freely without breaking the removal.
 */
function definedFieldName(node: ts.Expression): string | undefined {
  // `...(withOptions ? [defineField({ name: "x" })] : [])`: an optional field is still one field.
  if (ts.isSpreadElement(node)) {
    const spread = unwrapInitializer(node.expression);

    if (!ts.isConditionalExpression(spread)) {
      return undefined;
    }

    const whenTrue = unwrapInitializer(spread.whenTrue);
    const [only] = ts.isArrayLiteralExpression(whenTrue) && whenTrue.elements.length === 1 ? whenTrue.elements : [];

    return only ? definedFieldName(only) : undefined;
  }

  if (!ts.isCallExpression(node)) {
    return undefined;
  }

  const [argument] = node.arguments;

  if (!argument || !ts.isObjectLiteralExpression(argument)) {
    return undefined;
  }

  for (const property of argument.properties) {
    if (propertyName(property.name) !== "name" || !ts.isPropertyAssignment(property)) {
      continue;
    }

    if (ts.isStringLiteral(property.initializer)) {
      return property.initializer.text;
    }
  }

  return undefined;
}

/** A top-level `const`/`let` statement declaring `name`, with its JSDoc. */
function dropVariableStatementRanges(name: string, code: string, file: ts.SourceFile): Range[] {
  const ranges: Range[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node)) {
      const declarations = node.declarationList.declarations;
      const matches = declarations.filter((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name);

      if (matches.length > 0 && declarations.length === 1) {
        const { start } = rangeWithLeadingComments(node, code);
        let end = node.getEnd();

        if (code[end] === "\n") {
          end += 1;
        }

        ranges.push({ start, end });
      }
    }

    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isInterfaceDeclaration(node)) &&
      node.name?.text === name
    ) {
      const { start } = rangeWithLeadingComments(node, code);
      let end = node.getEnd();

      if (code[end] === "\n") {
        end += 1;
      }

      ranges.push({ start, end });
    }

    ts.forEachChild(node, visit);
  };

  visit(file);

  return ranges;
}

/** The union a type alias or a property is declared as: `type MediaType = "a" | "b"` or `type?: "a" | "b" | null`. */
function findUnionsNamed(file: ts.SourceFile, anchor: string): ts.UnionTypeNode[] {
  const found: ts.UnionTypeNode[] = [];

  const visit = (node: ts.Node): void => {
    const named =
      (ts.isTypeAliasDeclaration(node) && node.name.text === anchor) ||
      (ts.isPropertySignature(node) && propertyName(node.name) === anchor);
    const type = named ? (node as ts.TypeAliasDeclaration | ts.PropertySignature).type : undefined;

    if (type && ts.isUnionTypeNode(type)) {
      found.push(type);
    }

    ts.forEachChild(node, visit);
  };

  visit(file);

  return found;
}

/**
 * One string literal out of a union, with the `|` that joined it, so `"a" | "b" | "c"` loses `"b"`
 * and stays well formed whether the union is written on one line or one member per line.
 */
function dropUnionMemberRanges(anchor: string, value: string, file: ts.SourceFile): Range[] {
  return findUnionsNamed(file, anchor).flatMap((union) => {
    const members = union.types;

    return members.flatMap((member, index) => {
      if (!ts.isLiteralTypeNode(member) || !ts.isStringLiteral(member.literal) || member.literal.text !== value) {
        return [];
      }

      const previous = members[index - 1];
      const next = members[index + 1];

      if (previous) {
        return [{ start: previous.getEnd(), end: member.getEnd() }];
      }

      return next ? [{ start: member.getStart(), end: next.getStart() }] : [];
    });
  });
}

/**
 * A `case "<value>":` clause and its body. Its own statements go with it; a clause that only falls
 * through into the next one is just the label.
 */
function dropSwitchCaseRanges(value: string, code: string, file: ts.SourceFile): Range[] {
  const ranges: Range[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text === value) {
      const { start } = rangeWithLeadingComments(node, code);
      ranges.push(expandToWholeLines(code, start, node.getEnd()));
    }

    ts.forEachChild(node, visit);
  };

  visit(file);

  return ranges;
}

/**
 * The brace-balanced block `opens` starts, with its trailing comma and its own lines: a GROQ projection
 * (`lottieOptions{ … },`) or a `select` branch (`type == "lottie" && … => { … },`). GROQ has no AST
 * here, and matching the whole block as text would tie it to every line inside, including the ones
 * another removal takes out first.
 */
function dropBlockRanges(opens: string, code: string): Range[] {
  const ranges: Range[] = [];
  let at = code.indexOf(opens);

  while (at !== -1) {
    const open = code.indexOf("{", at);
    let depth = 0;
    let close = -1;

    for (let index = open; open !== -1 && index < code.length; index += 1) {
      depth += code[index] === "{" ? 1 : code[index] === "}" ? -1 : 0;

      if (depth === 0) {
        close = index;
        break;
      }
    }

    if (close !== -1) {
      ranges.push(expandToWholeLines(code, at, close + 1));
    }

    at = code.indexOf(opens, at + opens.length);
  }

  return ranges;
}

/** Whole lines containing `contains`, for Markdown, `.env` and other non-TS surfaces. */
function dropLineRanges(contains: string, code: string): Range[] {
  const ranges: Range[] = [];
  let offset = 0;

  for (const line of code.split("\n")) {
    if (line.includes(contains)) {
      ranges.push({ start: offset, end: offset + line.length + 1 });
    }

    offset += line.length + 1;
  }

  return ranges;
}

/**
 * How many times an edit is expected to match. One, unless it declares otherwise: the Markdown and
 * GROQ matchers are the only ones that legitimately hit a fixed number of places at once. `every`
 * takes however many there are, for a line repeated once per sibling that another removal thins out.
 */
function expectedMatches(edit: Edit): number {
  if (
    edit.kind === "dropLines" ||
    edit.kind === "replaceText" ||
    edit.kind === "dropCallStatement" ||
    edit.kind === "dropStringFromArray"
  ) {
    return edit.count ?? 1;
  }

  return 1;
}

function isExpectedCount(edit: Edit, matches: number): boolean {
  return edit.kind === "dropLines" && edit.every ? matches > 0 : matches === expectedMatches(edit);
}

/**
 * Applies `edits` to `source` and returns the new text.
 *
 * Every edit must match its expected number of times. A zero match means the anchor moved or was
 * already removed; an extra match means the anchor is ambiguous. Both throw `EditMatchError`, so a
 * caller collecting the whole plan can abort before writing anything.
 */
export function applyEdits(source: string, edits: Edit[], fileName = "source.tsx"): string {
  // Two whole-document rewrites cannot be disjoint ranges, so JSON keys fold in one at a time first.
  let code = source;

  for (const edit of edits) {
    if (edit.kind !== "dropJsonKey") {
      continue;
    }

    const [range] = jsonKeyRanges(edit.key, code, edit.in);

    if (range?.text === undefined) {
      throw new EditMatchError(edit, 0, fileName);
    }

    code = range.text;
  }

  const rest = edits.filter((edit) => edit.kind !== "dropJsonKey");

  if (rest.length === 0) {
    return code;
  }

  const parts = split(code, fileName);
  const dropped = droppedIds(rest);
  const ranges: Range[] = [];

  for (const edit of rest) {
    const matched = rangesFor(edit, code, parts, dropped);

    if (!isExpectedCount(edit, matched.length)) {
      throw new EditMatchError(edit, matched.length, fileName);
    }

    ranges.push(...matched);
  }

  // Dropping a desk item can leave the dividers that framed it adjacent, which reads as an empty group.
  ranges.push(
    ...droppedItemBlockRanges(rest, parts.code, parts.parsed).map((range) => ({
      ...range,
      start: range.start + parts.offset,
      end: range.end + parts.offset,
    }))
  );

  return spliceOut(code, ranges);
}

/**
 * Rewrites `ranges` out of `code`, back to front so earlier offsets stay valid. Two deletions that
 * overlap (a shared comma between neighbouring list entries) merge into one cut; anything
 * overlapping a replacement is a manifest bug and throws rather than producing mangled output.
 */
export function spliceOut(code: string, ranges: Range[]): string {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: Range[] = [];

  for (const range of sorted) {
    const last = merged.at(-1);

    if (last && range.start < last.end) {
      if (last.text !== undefined || range.text !== undefined) {
        throw new Error(`Overlapping edits at ${range.start}–${range.end}: two edits claim the same text.`);
      }

      last.end = Math.max(last.end, range.end);
      continue;
    }

    merged.push({ ...range });
  }

  let result = code;

  for (const range of merged.reverse()) {
    result = result.slice(0, range.start) + (range.text ?? "") + result.slice(range.end);
  }

  return result;
}

/**
 * The edits in `edits` that do not resolve against `source` the expected number of times. Used by
 * `manifest.test.ts` to fail the moment someone renames a registry out from under the manifest.
 */
export function verifyEdits(source: string, edits: Edit[], fileName: string): { edit: Edit; matches: number }[] {
  const parts = split(source, fileName);
  const dropped = droppedIds(edits);

  return edits
    .map((edit) => ({ edit, matches: rangesFor(edit, source, parts, dropped).length }))
    .filter(({ edit, matches }) => !isExpectedCount(edit, matches));
}

export type Unresolved = { file: string; edit: Edit; matches: number };

export type Resolution = {
  /** Only the edits that resolve, so a partial run can apply exactly these. */
  applicable: FileEdits[];
  /** Anchors this project has customized away, which no automated edit can safely guess at. */
  unresolved: Unresolved[];
  /** Edited files that are already gone. Nothing to do, not a problem. */
  missingFiles: string[];
};

/**
 * Every edit proven against the tree before anything is written. A structural matcher that finds
 * nothing is already satisfied; only an ambiguous anchor, or text this cannot recognise, needs a human.
 */
export function resolveEdits(groups: FileEdits[], exists: (path: string) => boolean, read: (file: string) => string): Resolution {
  const applicable: FileEdits[] = [];
  const unresolved: Unresolved[] = [];
  const missingFiles: string[] = [];

  for (const entry of groups) {
    // Nothing this project ever had, rather than something moved: skipped, not reported.
    if (entry.requires && !exists(entry.requires)) {
      continue;
    }

    if (!exists(entry.file)) {
      if (!entry.optional) {
        missingFiles.push(entry.file);
      }

      continue;
    }

    const failed = verifyEdits(read(entry.file), entry.edits, entry.file);
    const failedSet = new Set(failed.map(({ edit }) => edit));

    unresolved.push(
      ...failed
        .filter(({ edit, matches }) => !(matches === 0 && isSatisfiedWhenAbsent(edit)))
        .map(({ edit, matches }) => ({ file: entry.file, edit, matches }))
    );

    const usable = entry.edits.filter((edit) => !failedSet.has(edit));

    if (usable.length > 0) {
      applicable.push({ ...entry, edits: usable });
    }
  }

  return { applicable, unresolved, missingFiles };
}
