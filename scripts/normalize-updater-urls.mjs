import { readFileSync, writeFileSync } from "node:fs";

function readJson(path) {
    const bytes = readFileSync(path);
    const text = bytes[0] === 0xff && bytes[1] === 0xfe
        ? Buffer.from(bytes.subarray(2)).toString("utf16le")
        : bytes.toString("utf8");
    return JSON.parse(text.replace(/^\ufeff/, ""));
}

const [manifestPath, assetsPath] = process.argv.slice(2);
if (!manifestPath || !assetsPath) throw new Error("Usage: normalize-updater-urls.mjs <latest.json> <assets.json>");
const manifest = readJson(manifestPath);
const assets = readJson(assetsPath);
const urls = new Map((assets.assets ?? []).flatMap((a) => a.url && a.browser_download_url ? [[a.url, a.browser_download_url]] : []));
let replaced = 0;
for (const platform of Object.values(manifest.platforms ?? {})) {
    if (!platform?.url) continue;
    const url = urls.get(platform.url);
    if (url) { platform.url = url; replaced += 1; }
}
if (!replaced) throw new Error("No updater URLs were normalized");
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Normalized ${replaced} updater URL(s)`);
