import { spawnSync } from "node:child_process";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "..");
const outputDir = resolve(repositoryRoot, "src/lib/codex/protocol/generated");
const temporaryDir = mkdtempSync(join(tmpdir(), "codey-codex-protocol-"));

function listFiles(rootDir) {
    const files = [];
    for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
        const absolutePath = join(rootDir, entry.name);
        if (entry.isDirectory()) {
            files.push(...listFiles(absolutePath));
        } else if (entry.isFile() && entry.name.endsWith(".ts")) {
            files.push(absolutePath);
        }
    }
    return files;
}

try {
    const codexCommand = "codex";
    const result = spawnSync(codexCommand, ["app-server", "generate-ts", "--out", temporaryDir], {
        cwd: repositoryRoot,
        stdio: "inherit",
        shell: process.platform === "win32",
    });

    if (result.error) {
        throw new Error(`Unable to run ${codexCommand}: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(`Codex protocol generation exited with status ${result.status}`);
    }

    let copied = 0;
    let unchanged = 0;
    for (const sourcePath of listFiles(temporaryDir)) {
        const relativePath = relative(temporaryDir, sourcePath);
        const targetPath = join(outputDir, relativePath);
        const source = readFileSync(sourcePath);
        if (existsSync(targetPath) && readFileSync(targetPath).equals(source)) {
            unchanged += 1;
            continue;
        }
        mkdirSync(dirname(targetPath), { recursive: true });
        copyFileSync(sourcePath, targetPath);
        copied += 1;
    }

    const generatedPaths = new Set(
        listFiles(temporaryDir).map((filePath) => relative(temporaryDir, filePath))
    );
    const stalePaths = listFiles(outputDir)
        .map((filePath) => relative(outputDir, filePath))
        .filter((filePath) => !generatedPaths.has(filePath));

    console.log(`Codex protocol generated: ${copied} updated, ${unchanged} unchanged.`);
    if (stalePaths.length > 0) {
        console.warn(
            `Generated output contains ${stalePaths.length} stale file(s); review and remove them manually if no longer needed.`
        );
    }
} catch (error) {
    if (error instanceof Error && /user-mapped section|being used by another process/i.test(error.message)) {
        throw new Error(
            "Protocol files are in use. Close the running Codey/Vite process and run yarn codex:protocol:generate again."
        );
    }
    throw error;
} finally {
    rmSync(temporaryDir, { recursive: true, force: true });
}
