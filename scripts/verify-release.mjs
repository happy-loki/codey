import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const platforms = {
    "windows-x86_64": { suffix: "windows-x64", extension: ".msi" },
    "darwin-aarch64": { suffix: "macos-arm64", extension: ".app.tar.gz" },
    "darwin-x86_64": { suffix: "macos-x64", extension: ".app.tar.gz" },
};

export function validateRelease(manifest, assets, version, repo) {
    assert.equal(manifest.version?.replace(/^v/, ""), version, "Updater version mismatch");
    const byUrl = new Map(assets.flatMap(asset => [[asset.url, asset], [asset.apiUrl, asset]]));
    for (const [target, config] of Object.entries(platforms)) {
        assert.ok(manifest.platforms?.[target], `Missing updater platform: ${target}`);
        if (target.startsWith("darwin")) {
            assert.ok(assets.some(asset => asset.name === `codey-v${version}-${config.suffix}-dmg.dmg` && asset.size > 0),
                `Missing DMG: ${target}`);
        }
    }
    const signatures = new Map();
    for (const [target, entry] of Object.entries(manifest.platforms)) {
        const baseTarget = Object.keys(platforms).find(key => target === key || target === `${key}-${key.startsWith("darwin") ? "app" : "msi"}`);
        assert.ok(baseTarget, `Unexpected updater platform: ${target}`);
        const config = platforms[baseTarget];
        const asset = byUrl.get(entry.url);
        assert.ok(asset && asset.size > 0, `Missing update asset: ${target}`);
        assert.ok(asset.name.startsWith(`codey-v${version}-${config.suffix}-`) && asset.name.endsWith(config.extension),
            `Wrong installer or architecture: ${target}`);
        assert.ok(typeof entry.signature === "string" && entry.signature.trim(), `Missing update signature: ${target}`);
        const signatureAsset = assets.find(candidate => candidate.name === `${asset.name}.sig` && candidate.size > 0);
        assert.ok(signatureAsset, `Missing signature asset: ${target}`);
        if (signatures.has(signatureAsset.name)) {
            assert.equal(signatures.get(signatureAsset.name).signature, entry.signature.trim(), `Conflicting signature: ${target}`);
        }
        signatures.set(signatureAsset.name, { asset: signatureAsset, signature: entry.signature.trim() });
    }
    assert.ok(!assets.some(asset => asset.name.endsWith(".exe")), "Release must contain the MSI installer, not a plain executable");
    return [...signatures.values()];
}

function gh(args) {
    return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
}

function main() {
    const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
    const repo = process.env.GITHUB_REPOSITORY || "happy-loki/codey";
    const release = JSON.parse(gh(["release", "view", `v${version}`, "--repo", repo,
        "--json", "assets,isDraft,targetCommitish"]));
    assert.ok(release.isDraft, "Only an unpublished draft can pass the publish gate");
    if (process.env.GITHUB_SHA) assert.equal(release.targetCommitish, process.env.GITHUB_SHA, "Release commit mismatch");
    const manifestAsset = release.assets.find(asset => asset.name === "latest.json");
    assert.ok(manifestAsset, "Missing latest.json");
    const download = asset => gh(["api", asset.apiUrl, "-H", "Accept: application/octet-stream"]);
    const manifest = JSON.parse(download(manifestAsset));
    for (const { asset, signature } of validateRelease(manifest, release.assets, version, repo)) {
        assert.equal(download(asset).trim(), signature, `Manifest signature differs from ${asset.name}`);
    }
    console.log(`Release v${version} verified: Windows MSI, both macOS DMGs, and all three signed updater bundles.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
