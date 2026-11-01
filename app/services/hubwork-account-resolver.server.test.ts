import assert from "node:assert/strict";
import test from "node:test";
import { extractAllowedSlugHost } from "./hubwork-account-resolver.server.ts";

test("slug routing accepts kiokuflow and retained legacy domains while reserving the main app", () => {
  for (const domain of ["kiokuflow.net", "gemihub.net", "gemihub.online"]) {
    assert.equal(extractAllowedSlugHost(`acme.${domain}`), "acme");
    assert.equal(extractAllowedSlugHost(domain), null);
    assert.equal(extractAllowedSlugHost(`www.${domain}`), null);
    assert.equal(extractAllowedSlugHost(`nested.acme.${domain}`), null);
  }
  assert.equal(extractAllowedSlugHost("acme.localhost"), "acme");
  assert.equal(extractAllowedSlugHost("localhost"), null);
  assert.equal(extractAllowedSlugHost("acme.example.com"), null);
});
