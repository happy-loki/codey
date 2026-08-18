#!/usr/bin/env node

import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const pkgPath = path.join(repoRoot, "package.json");
const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
const cargoTomlPath = path.join(repoRoot, "src-tauri", "Cargo.toml");

function main() {
    const version = readPackageVersion();
    syncTauriConfig(version);
    syncCargoToml(version);
    console.log(`Synced version from package.json -> ${version}`);
}

function readPackageVersion() {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (!pkg?.version) {
        throw new Error("package.json is missing version");
    }
    return pkg.version;
}

function syncTauriConfig(version) {
    const config = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
    config.version = version;
    writeFileSync(tauriConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function syncCargoToml(version) {
    const raw = readFileSync(cargoTomlPath, "utf8");
    const updated = raw.replace(
        /(\[package\][\s\S]*?version\s*=\s*")([^"]+)(")/,
        (_, prefix, _oldVersion, suffix) => `${prefix}${version}${suffix}`,
    );
    writeFileSync(cargoTomlPath, updated, "utf8");
}

main();
