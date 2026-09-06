import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const baselinePath = path.join(root, "scripts/typecheck-baseline.json");

export function normalize(value, workspace) {
    const normalizedValue = value.replaceAll("\\", "/");
    const normalizedWorkspace = workspace.replaceAll("\\", "/").replace(/\/$/, "");
    const escapedWorkspace = normalizedWorkspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Windows drive-letter casing is not stable across Node and TypeScript output.
    return normalizedValue.replace(new RegExp(escapedWorkspace, "gi"), "<workspace>");
}

export function parseDiagnostics(stdout, status) {
    const errors = [];
    let summary;
    for (const line of stdout.split(/\r?\n/)) {
        const diagnostic = /^\d+ (\{.*\})$/.exec(line);
        if (diagnostic) {
            const entry = JSON.parse(diagnostic[1]);
            if (entry.type === "ERROR") {
                if (typeof entry.filename !== "string" || typeof entry.message !== "string" ||
                    !Number.isInteger(entry.start?.line) || entry.start.line < 0 || entry.code == null) {
                    throw new Error("Malformed svelte-check diagnostic.");
                }
                errors.push(entry);
            }
        }
        const completed = /^\d+ COMPLETED (\d+) FILES (\d+) ERRORS (\d+) WARNINGS (\d+) FILES_WITH_PROBLEMS$/.exec(line);
        if (completed) summary = { files: Number(completed[1]), errors: Number(completed[2]), warnings: Number(completed[3]) };
    }
    // A crashed checker, changed output format, or empty scan must never pass the gate.
    if (!summary || summary.files === 0 || summary.errors !== errors.length ||
        status !== (errors.length > 0 ? 1 : 0)) {
        throw new Error("svelte-check did not finish a complete, valid scan.");
    }
    return { errors, summary };
}

function fingerprint(entry) {
    return JSON.stringify([entry.file, entry.code, entry.message, entry.source]);
}

export function createBaseline(errors, workspace, readSource) {
    const entries = new Map();
    const sources = new Map();
    for (const error of errors) {
        const file = error.filename.replaceAll("\\", "/");
        if (!file.startsWith("src/") || file.split("/").includes("..")) {
            throw new Error(`Unexpected diagnostic outside src/: ${file}`);
        }
        if (!sources.has(file)) sources.set(file, readSource(file).split(/\r?\n/));
        const source = sources.get(file)[error.start.line];
        if (source === undefined) throw new Error(`Diagnostic location does not exist: ${file}`);
        const entry = {
            file,
            code: error.code,
            message: normalize(error.message, workspace),
            // Anchor to source text instead of line numbers so inserting a line does not
            // invalidate unrelated debt, while the same error at a new site is detected.
            source: source.trim(),
            count: 1,
        };
        const key = fingerprint(entry);
        if (entries.has(key)) entries.get(key).count++;
        else entries.set(key, entry);
    }
    return { version: 1, entries: [...entries.values()].sort((a, b) => {
        const left = fingerprint(a), right = fingerprint(b);
        return left < right ? -1 : left > right ? 1 : 0;
    }) };
}

export function compareBaselines(current, baseline) {
    if (baseline.version !== 1 || !Array.isArray(baseline.entries)) throw new Error("Unsupported typecheck baseline.");
    const previous = new Map();
    for (const entry of baseline.entries) {
        if (!Number.isInteger(entry.count) || entry.count < 1 || previous.has(fingerprint(entry))) {
            throw new Error("Invalid or duplicate baseline entry.");
        }
        previous.set(fingerprint(entry), entry);
    }
    const added = [], removed = [];
    for (const entry of current.entries) {
        const key = fingerprint(entry);
        const difference = entry.count - (previous.get(key)?.count ?? 0);
        if (difference > 0) added.push({ ...entry, count: difference });
        if (difference < 0) removed.push({ ...entry, count: -difference });
        previous.delete(key);
    }
    removed.push(...previous.values());
    return { added, removed };
}

function main() {
    const args = process.argv.slice(2);
    if (args.length > 1 || args.some(arg => !["--init-baseline", "--update-baseline"].includes(arg))) {
        throw new Error("Usage: node scripts/check-type-baseline.mjs [--init-baseline | --update-baseline]");
    }
    const result = spawnSync(process.execPath, [
        path.join(root, "node_modules/svelte-check/bin/svelte-check"),
        "--workspace", root, "--tsconfig", "./tsconfig.json", "--config", "./vite.config.ts",
        "--output", "machine-verbose", "--threshold", "error",
    ], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.stderr) process.stderr.write(normalize(result.stderr, root));
    const { errors, summary } = parseDiagnostics(result.stdout, result.status);
    const current = createBaseline(errors, root, file => readFileSync(path.join(root, file), "utf8"));
    console.log(`Svelte/TypeScript: ${summary.files} files, ${summary.errors} errors, ${summary.warnings} warnings.`);
    if (args[0] === "--init-baseline") {
        // Exclusive creation prevents this bootstrap option from enlarging an existing baseline.
        writeFileSync(baselinePath, JSON.stringify(current, null, 2) + "\n", { flag: "wx" });
        console.log("Initial existing-error baseline recorded. Review and commit it before running CI.");
        return;
    }
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const { added, removed } = compareBaselines(current, baseline);
    if (added.length) {
        for (const entry of added) console.error(`${entry.file} [${entry.code}] (+${entry.count}) ${entry.message}\n  ${entry.source}`);
        throw new Error("New type errors detected. Fix them; the update command cannot add errors to the baseline.");
    }
    if (args[0] === "--update-baseline") {
        writeFileSync(baselinePath, JSON.stringify(current, null, 2) + "\n");
        console.log("Baseline updated; only resolved errors were removed.");
        return;
    }
    if (removed.length) throw new Error("Type errors have been resolved. Run yarn check:baseline:update and commit the reduced baseline.");
    console.log(`Typecheck gate passed: ${summary.errors} known errors, 0 new errors. Full diagnostics: yarn run check.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try { main(); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
