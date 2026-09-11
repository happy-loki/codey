import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function readJson(path) {
    const bytes = readFileSync(path);
    const text = bytes[0] === 0xff && bytes[1] === 0xfe
        ? Buffer.from(bytes.subarray(2)).toString("utf16le")
        : bytes.toString("utf8");
    return JSON.parse(text.replace(/^\ufeff/, ""));
}

export function normalizeUpdaterUrls(manifest, release) {
    assert.equal(release.draft, true, "Only an unpublished draft can be normalized");
    assert.equal(release.tag_name, `v${manifest.version?.replace(/^v/, "")}`, "Release tag and updater version mismatch");
    const repo = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/releases\/\d+$/.exec(release.url)?.[1];
    assert.ok(repo, "Missing GitHub release API URL");
    assert.ok(Object.keys(manifest.platforms ?? {}).length, "Missing updater platforms");
    const urls = new Map((release.assets ?? []).flatMap(asset => {
        // Draft browser_download_url values can contain an untagged-* slug.
        const downloadUrl = `https://github.com/${repo}/releases/download/${encodeURIComponent(release.tag_name)}/${encodeURIComponent(asset.name)}`;
        return [asset.url, asset.browser_download_url, downloadUrl]
            .filter(Boolean).map(url => [url, downloadUrl]);
    }));
    const platforms = Object.fromEntries(Object.entries(manifest.platforms).map(([target, entry]) => {
        const url = urls.get(entry?.url);
        assert.ok(url, `Updater URL does not match a release asset: ${target}`);
        return [target, { ...entry, url }];
    }));
    return { ...manifest, platforms };
}

function main() {
    const [manifestPath, assetsPath] = process.argv.slice(2);
    if (!manifestPath || !assetsPath) throw new Error("Usage: normalize-updater-urls.mjs <latest.json> <assets.json>");
    const manifest = normalizeUpdaterUrls(readJson(manifestPath), readJson(assetsPath));
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`Normalized ${Object.keys(manifest.platforms).length} updater URL(s)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
