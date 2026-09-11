import assert from "node:assert/strict";
import test from "node:test";
import { validateRelease } from "./verify-release.mjs";
import { normalizeUpdaterUrls } from "./normalize-updater-urls.mjs";

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
        manifest.platforms[target] = { url: asset.url, signature: "signed-bundle" };
        if (target.startsWith("darwin")) add(`codey-v0.0.50-${suffix}-dmg.dmg`);
    }
    return { manifest, assets };
}

const validate = ({ manifest, assets }) => validateRelease(manifest, assets, "0.0.50", "happy-loki/codey");

test("accepts a complete release using public versioned download URLs", () => {
    assert.equal(validate(fixture()).length, 3);
});

function draftFixture(version = "0.0.50") {
    const { manifest, assets } = JSON.parse(JSON.stringify(fixture()).replaceAll("0.0.50", version));
    const release = {
        draft: true, tag_name: `v${version}`,
        url: "https://api.github.com/repos/happy-loki/codey/releases/123",
        assets: assets.map(asset => ({
            name: asset.name, size: asset.size, url: asset.apiUrl,
            browser_download_url: asset.url.replace(`v${version}/`, "untagged-draft/"),
        })),
    };
    return { manifest, assets, release };
}

test("normalizes API and temporary draft URLs, preserves signatures, and permits retries", () => {
    // A subsequent release must get its own versioned URLs, not a fixed tag.
    const { manifest, assets, release } = draftFixture("0.0.56");
    const expected = structuredClone(manifest);
    manifest.platforms["windows-x86_64"].url = release.assets[0].url;
    const mac = release.assets.find(asset => asset.name.endsWith("macos-arm64-app.app.tar.gz"));
    manifest.platforms["darwin-aarch64"].url = mac.browser_download_url;
    manifest.platforms["windows-x86_64-msi"] = structuredClone(manifest.platforms["windows-x86_64"]);
    expected.platforms["windows-x86_64-msi"] = structuredClone(expected.platforms["windows-x86_64"]);
    const normalized = normalizeUpdaterUrls(manifest, release);
    assert.deepEqual(normalized, expected);
    assert.deepEqual(normalizeUpdaterUrls(normalized, release), expected);
    const draftAssets = assets.map(asset => ({ ...asset, url: asset.url.replace("v0.0.56/", "untagged-draft/") }));
    assert.equal(validateRelease(normalized, draftAssets, "0.0.56", "happy-loki/codey").length, 3);
});

test("blocks publishing API, temporary, wrong-tag and wrong-repository URLs", () => {
    for (const invalidUrl of [
        "https://api.github.com/repos/happy-loki/codey/releases/assets/1",
        "https://github.com/happy-loki/codey/releases/download/untagged-draft/codey-v0.0.50-windows-x64-msi.msi",
        "https://github.com/happy-loki/codey/releases/download/v0.0.49/codey-v0.0.50-windows-x64-msi.msi",
        "https://github.com/happy-loki/other/releases/download/v0.0.50/codey-v0.0.50-windows-x64-msi.msi",
    ]) {
        const data = fixture();
        data.assets[0].url = invalidUrl;
        data.manifest.platforms["windows-x86_64"].url = invalidUrl;
        assert.throws(() => validate(data), /public versioned download URL/);
    }
});

test("normalization rejects mismatched releases, unknown assets and published releases", () => {
    const { manifest, release } = draftFixture();
    assert.throws(() => normalizeUpdaterUrls(manifest, { ...release, tag_name: "v0.0.51" }), /version mismatch/);
    assert.throws(() => normalizeUpdaterUrls(manifest, { ...release, draft: false }), /unpublished draft/);
    assert.throws(() => normalizeUpdaterUrls(manifest, { ...release, assets: [] }), /does not match/);
    manifest.platforms["windows-x86_64"].url = "https://example.com/installer.msi";
    assert.throws(() => normalizeUpdaterUrls(manifest, release), /does not match/);
});

test("blocks publishing incomplete platform builds or missing signatures", () => {
    const missing = fixture();
    delete missing.manifest.platforms["darwin-x86_64"];
    assert.throws(() => validate(missing), /Missing updater platform/);
    const unsigned = fixture();
    unsigned.assets = unsigned.assets.filter(asset => !asset.name.endsWith(".sig"));
    assert.throws(() => validate(unsigned), /Missing signature asset/);
});

test("rejects wrong versions, architecture mappings, and assets outside the release", () => {
    const wrongVersion = fixture();
    wrongVersion.manifest.version = "0.0.49";
    assert.throws(() => validate(wrongVersion), /version mismatch/);
    const wrongArch = fixture();
    wrongArch.manifest.platforms["darwin-aarch64"] = wrongArch.manifest.platforms["darwin-x86_64"];
    assert.throws(() => validate(wrongArch), /Wrong installer or architecture/);
    const externalAsset = fixture();
    externalAsset.manifest.platforms["windows-x86_64"].url =
        "https://api.github.com/repos/happy-loki/codey/releases/assets/999999";
    assert.throws(() => validate(externalAsset), /Missing update asset/);
});
