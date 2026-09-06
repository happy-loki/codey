import assert from "node:assert/strict";
import test from "node:test";
import { compareBaselines, createBaseline, normalize, parseDiagnostics } from "./check-type-baseline.mjs";

const diagnostic = { type: "ERROR", filename: "src/example.ts", code: 2322, message: "Type mismatch", start: { line: 0 } };
const output = (entries, total = entries.length) => entries.map(entry => `1 ${JSON.stringify(entry)}`).join("\n") +
    `\n2 COMPLETED 10 FILES ${total} ERRORS 0 WARNINGS 1 FILES_WITH_PROBLEMS\n`;
const baselineFor = (entries, source = "const value: string = 1;") => createBaseline(entries, "/repo", () => source);

test("rejects a crashed, truncated, empty, or inconsistent scan", () => {
    assert.throws(() => parseDiagnostics(output([diagnostic]), null));
    assert.throws(() => parseDiagnostics("", 0));
    assert.throws(() => parseDiagnostics(output([diagnostic], 2), 1));
    assert.throws(() => parseDiagnostics(output([], 0).replace("10 FILES", "0 FILES"), 0));
    assert.equal(parseDiagnostics(output([diagnostic]), 1).errors.length, 1);
    assert.equal(parseDiagnostics(output([]), 0).errors.length, 0);
});

test("normalizes checkout paths and Windows separators", () => {
    assert.equal(normalize("C:\\work\\codey\\node_modules\\pkg", "C:\\work\\codey\\"), "<workspace>/node_modules/pkg");
    assert.equal(normalize("/repo/node_modules/pkg", "/repo/"), "<workspace>/node_modules/pkg");
    assert.deepEqual(baselineFor([{ ...diagnostic, filename: "src\\example.ts" }]), baselineFor([diagnostic]));
});

test("line insertions preserve debt, but the same error at a new source site fails", () => {
    const baseline = baselineFor([diagnostic]);
    const moved = baselineFor([{ ...diagnostic, start: { line: 1 } }], "// inserted\nconst value: string = 1;");
    assert.deepEqual(compareBaselines(moved, baseline), { added: [], removed: [] });
    assert.equal(compareBaselines(baselineFor([diagnostic], "const other: string = 1;"), baseline).added.length, 1);
});

test("a fixed error cannot offset a new error with the same overall count", () => {
    const result = compareBaselines(baselineFor([{ ...diagnostic, code: 2345 }]), baselineFor([diagnostic]));
    assert.equal(result.added.length, 1);
    assert.equal(result.removed.length, 1);
});

test("tracks duplicate errors and resolved errors for a downward-only update", () => {
    const one = baselineFor([diagnostic]), two = baselineFor([diagnostic, diagnostic]);
    assert.equal(compareBaselines(two, one).added[0].count, 1);
    assert.equal(compareBaselines(one, two).removed[0].count, 1);
    assert.equal(compareBaselines(baselineFor([]), one).removed.length, 1);
});

test("rejects diagnostics outside the source tree and invalid baseline counts", () => {
    assert.throws(() => baselineFor([{ ...diagnostic, filename: "../secret.ts" }]));
    assert.throws(() => baselineFor([{ ...diagnostic, filename: "src/../secret.ts" }]));
    assert.throws(() => baselineFor([{ ...diagnostic, start: { line: 99 } }]));
    const baseline = baselineFor([diagnostic]);
    baseline.entries[0].count = -1;
    assert.throws(() => compareBaselines(baselineFor([diagnostic]), baseline));
});
