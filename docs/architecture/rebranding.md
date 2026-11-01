# kiokuflow migration

The target service is **kiokuflow** (lowercase), at **https://kiokuflow.net**. DNS A records and the certificate DNS-authorization CNAME have been published, and five additive certificate resources have been created; OAuth/application cutover is still pending. This change updates the application and deployment configuration; it does not register the domain, change live DNS/OAuth settings, or deploy production automatically.

## Existing data

- New accounts use a `kiokuflow` Drive folder. Sign-in first looks for that folder and then reuses an existing `gemihub` folder by ID. Explicit `ROOT_FOLDER_NAME` settings remain authoritative. Do not rename or copy existing folders for this migration.
- Existing settings, RSA identities, encrypted credentials, subscriptions, organization projects and Firestore RAG indexes retain their identifiers. The built-in RAG index is displayed as `kiokuflow`, while its stored key stays `gemihub`.
- Browser caches and login cookies are origin-specific. Before moving from the old site, **Push all local edits on every device**. Sign in again at the new site, then Pull. Existing encryption passwords still unlock the same private keys. Browser-only preferences may need to be set again.
- The extracted Web Builder continues as GemiHub in `../omaiweb` and takes over the old public domain. kiokuflow deployment is scoped to its new domain; legacy browser caches can be recovered separately if needed.
- Existing hosted sites work at `<slug>.gemihub.net` and `<slug>.gemihub.online`; the settings screen advertises `<slug>.kiokuflow.net`. Custom domains stay unchanged. External websites with hard-coded old origins must be updated separately.

## OAuth separation from GemiHub

The extracted Web Builder in `../omaiweb` keeps the **GemiHub** service identity and its existing approved OAuth configuration. kiokuflow removes Google Calendar/Gmail integration and requests only `drive.file` during normal sign-in. Existing GemiHub Google Cloud API enablement and OAuth approval are not revoked by this repository.

The local `.env` is a development credential set. It differs from the original production OAuth credentials referenced by `shared-apps-runtime` in project `geminihub-486523`: Secret Manager `google-client-id` and `google-client-secret` (verified 2026-11-02 without displaying secret values). Reusing that production identity for GemiHub should reference those secrets.

Non-sensitive `drive.file` avoids sensitive/restricted-scope verification. Brand verification is separate and is needed to display an app name/logo on Google's consent screen. A new unverified brand can use domain-only display where Google's current requirements permit it; do not promise that removing Calendar/Gmail alone eliminates brand review. A separate OAuth project also changes Drive app access: existing app-created files are not automatically granted to a new application. Plan and verify that migration before replacing kiokuflow's production OAuth credentials.

## Deployment sequence

1. `kiokuflow.net` is registered with Cloudflare Registrar, so its authoritative nameservers stay at Cloudflare. `branding.auto.tfvars` sets `domain = "kiokuflow.net"`, `legacy_app_domain = "gemihub.net"` and `manage_rebrand_dns = false`. Do not disable the module-wide `manage_dns`: the old domain's Cloud DNS zone and certificates must stay managed. The new domain gets additive DNS authorization, apex/wildcard certificates and certificate-map entries; its DNS records are created in Cloudflare. Existing IP, backends, VM, buckets and databases retain their identities. Review the production plan before applying; do not replace these resources unexpectedly.
2. In Cloudflare **kiokuflow.net → DNS → Records**, add `A @` and `A *` pointing to the existing load-balancer IP (`34.120.253.130`, confirmed 2026-11-02); use **DNS only** (gray cloud), TTL Auto. Prepare the new Certificate Manager DNS authorization/certificates/map entries after reviewing the plan. Publish the exact CNAME returned by `terraform -chdir=terraform/environments/prod output -json rebrand_dns_authorization` in Cloudflare, also **DNS only**, and retain it for automatic renewal. Wait for both certificates to become ACTIVE before application cutover. With external DNS, `nameservers` is empty; `legacy_nameservers` still reports the retained old zone. If Google site verification is required, add the new domain's verification TXT in Cloudflare rather than reusing the old token. A records alone do not make the new application ready.
3. **OAuth review gate:** check Branding and Verification Center before changing production OAuth settings. Changes to the app name, redirect URI, homepage/privacy-policy URLs or authorized domains require brand re-verification. Unchanged scopes do not require additional scope justification. Branding changes are not permitted during verification; do not automatically cancel an existing review. Confirm its status and coordinate the migration with the review team first. Prepare a publicly accessible new-domain homepage/privacy policy and verify `kiokuflow.net` ownership in Search Console for the project owner account. Once the review sequence is agreed, add `https://kiokuflow.net/auth/google/callback` to the existing Google OAuth client. Keep old callback URIs during migration. Update the consent-screen application name, application home, privacy policy, terms links and authorized domains. Where Google Picker is enabled, add the new origin to the browser API key’s HTTP-referrer restrictions as well. Callback URLs are derived from the request origin.
4. Deploy the application with `KIOKUFLOW_MAIN_DOMAIN=kiokuflow.net`. For the shared VM, update its actual runtime environment/secrets separately (Cloud Run variables do not configure the shared VM). Keep the deployment group `gemihub` and current GCP resources. Set `BLUESKY_PUBLIC_URL=https://kiokuflow.net` where Bluesky is enabled; update external OAuth/MCP client registrations and Stripe return URLs or webhook endpoints that use the old origin. Keep existing endpoints available until those registrations are migrated.
5. Verify login/logout, Drive root-folder reuse, decryption, Push/Pull, paid RAG, Gemini/OpenAI Live, hosted slug/custom-domain sites, public file links, scheduled jobs and external Drive-sync clients on the deployed environment. Check Japanese/English pages and phones. Local automated tests do not establish deployed or authenticated end-to-end success.
6. Keep the old domain serving the application while users migrate. `KIOKUFLOW_REDIRECT_LEGACY_UI` defaults to off to protect unsynced browser data. Enable it only after migration; `?legacy=1` reopens the old UI for recovery. Redirects exclude API and authentication routes so legacy clients/callbacks remain reachable. Keep old DNS and certificates while these clients depend on them.

## Documentation and screenshots

Japanese and English product text, landing pages, README and manuals use the new name. 47 screenshots were captured from current Storybook components. Obsolete captures without a current reproducible scene are no longer embedded; the feature explanations remain. Unused historical image files are retained. Third-party plugin screenshots without the old service header remain valid.

Build the updated help bundle with `npm run okf:package` and publish its versioned ZIP before the manifest using the steps in [Infrastructure](infrastructure.md). The generated artifacts are local until uploaded; do not replace an existing immutable release.

## Compatibility names retained

`GEMIHUB_MAIN_DOMAIN` and `GEMIHUB_OKF_*` remain fallback environment aliases; new configurations should use `KIOKUFLOW_MAIN_DOMAIN` and `KIOKUFLOW_OKF_*`. The current brand defaults to `kiokuflow.net` if neither domain variable is set.

Published applications can use `window.kiokuflow`; `window.gemihub` is the same SDK object. Existing `/__gemihub/*` routes, `web/__gemihub/` mock/schema files, `/api/okf/gemihub`, `gemihub-okf` distribution paths, `gemihub-command` workflow nodes, browser storage keys and Firestore index keys remain compatible. Both current and old OKF manifests are accepted.

The application repository is now [takeshy/kiokuflow](https://github.com/takeshy/kiokuflow). Existing local checkouts can update their remote with `git remote set-url origin git@github.com:takeshy/kiokuflow.git`; the checkout directory can retain its existing name.

The `gemihub-sync-core` dependency, the separately released **GemiHub - Drive Sync** Obsidian plugin and **GemiHub Desktop** keep their actual names and URLs. This repository does not rename or publish those external products. Historical screenshot filenames and internal API/type names are also stable; user-facing labels use the new service name.

## DNS provider references

- [Cloudflare Registrar nameserver restriction](https://developers.cloudflare.com/registrar/get-started/register-domain/): domains registered there keep Cloudflare nameservers.
- [Google Certificate Manager DNS authorization](https://docs.cloud.google.com/certificate-manager/docs/dns-authorizations): publish the returned CNAME at the authoritative DNS provider.
- [Cloudflare proxy status](https://developers.cloudflare.com/dns/proxy-status/): use DNS only for initial routing and certificate verification.

- [Changes to an approved OAuth app](https://support.google.com/cloud/answer/13464018): name, redirect and branding changes require brand re-verification; unchanged scopes need no additional justification.
- [Brand verification and pending reviews](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification): check the existing review before editing branding or cancelling verification.
