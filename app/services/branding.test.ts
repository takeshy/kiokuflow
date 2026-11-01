import assert from "node:assert/strict";
import test from "node:test";
import { isMainAppDomain, isReservedPlatformDomain, platformSlug, ragSettingDisplayName, SERVICE_NAME, PUBLIC_DOMAIN } from "~/config/branding";
import { parseGemihubOkfManifest, isGemihubOkfBundleName } from "./gemihub-okf-manifest";

test("kiokuflow and legacy platform domains remain distinct from user-hosted sites", () => {
  assert.equal(SERVICE_NAME, "kiokuflow"); assert.equal(PUBLIC_DOMAIN, "kiokuflow.net");
  for (const domain of ["kiokuflow.net", "gemihub.net", "gemihub.online"]) {
    assert.equal(isMainAppDomain(domain), true); assert.equal(isMainAppDomain(`www.${domain}`), true);
    assert.equal(isReservedPlatformDomain(domain), true); assert.equal(isReservedPlatformDomain(`alice.${domain}`), true);
    assert.equal(platformSlug(`alice.${domain}`), "alice"); assert.equal(platformSlug(`www.${domain}`), null);
    assert.equal(isMainAppDomain(`alice.${domain}`), false); assert.equal(platformSlug(`sub.alice.${domain}`), null);
  }
  assert.equal(platformSlug("alice.localhost"), "alice");
  assert.equal(platformSlug("alice.kiokuflow.net.attacker.invalid"), null);
  assert.equal(isReservedPlatformDomain("kiokuflow.net.attacker.invalid"), false);
  assert.equal(isMainAppDomain("selfhost.example", "selfhost.example"), true);
  assert.equal(platformSlug("alice.selfhost.example", "selfhost.example"), "alice");
});

test("old OKF manifests and RAG identifiers keep their data identity with the new display name", () => {
  const manifest = { name: "kiokuflow", version: "1.0.1", publishedAt: "2026-11-02T00:00:00Z", bundleUrl: "releases/1.0.1/gemihub-okf.zip", sha256: "a".repeat(64), files: { "index.md": "b".repeat(64) } };
  assert.equal(parseGemihubOkfManifest(manifest).name, "kiokuflow");
  assert.equal(parseGemihubOkfManifest({ ...manifest, name: "GemiHub" }).name, "GemiHub");
  assert.ok(isGemihubOkfBundleName("gemihub-okf")); assert.ok(isGemihubOkfBundleName("kiokuflow"));
  assert.equal(ragSettingDisplayName("gemihub"), "kiokuflow"); assert.equal(ragSettingDisplayName("my-index"), "my-index");
});
