import assert from "node:assert/strict";
import test from "node:test";
import { validateRelease } from "./verify-release.mjs";

function fixture() {
    const assets = [], manifest = { version: "0.0.50", platforms: {} };
    const add = name => {
        const asset = { name, size: 128, url: `https://github.com/happy-loki/codey/releases/download/v0.0.50/${name}`,
            apiUrl: `https://api.github.com/repos/happy-loki/codey/releases/assets/${assets.length + 1}` };
        assets.push(asset);
        return asset;
    };
    for (const [target, suffix, bundle] of [
        ["windows-x86_64", "windows-x64", "msi.msi"],
        ["darwin-aarch64", "macos-arm64", "app.app.tar.gz"],
        ["darwin-x86_64", "macos-x64", "app.app.tar.gz"],
    ]) {
        const asset = add(`codey-v0.0.50-${suffix}-${bundle}`);
        add(`${asset.name}.sig`);
        manifest.platforms[target] = { url: asset.apiUrl, signature: "signed-bundle" };
        if (target.startsWith("darwin")) add(`codey-v0.0.50-${suffix}-dmg.dmg`);
    }
    return { manifest, assets };
}

const validate = ({ manifest, assets }) => validateRelease(manifest, assets, "0.0.50", "happy-loki/codey");

test("accepts a complete release using Tauri action API asset URLs", () => {
    assert.equal(validate(fixture()).length, 3);
});

test("blocks publishing incomplete platform builds or missing signatures", () => {
    const missing = fixture();
    delete missing.manifest.platforms["darwin-x86_64"];
    assert.throws(() => validate(missing), /Missing updater platform/);
    const unsigned = fixture();
    unsigned.assets = unsigned.assets.filter(asset => !asset.name.endsWith(".sig"));
    assert.throws(() => validate(unsigned), /Missing signature asset/);
});

test("rejects wrong versions, architecture mappings, and previous release assets", () => {
    const wrongVersion = fixture();
    wrongVersion.manifest.version = "0.0.49";
    assert.throws(() => validate(wrongVersion), /version mismatch/);
    const wrongArch = fixture();
    wrongArch.manifest.platforms["darwin-aarch64"] = wrongArch.manifest.platforms["darwin-x86_64"];
    assert.throws(() => validate(wrongArch), /Wrong installer or architecture/);
    const oldAsset = fixture();
    oldAsset.assets[0].url = oldAsset.assets[0].url.replace("/v0.0.50/", "/v0.0.49/");
    assert.throws(() => validate(oldAsset), /another release/);
});
