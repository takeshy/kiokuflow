export const SERVICE_NAME = "kiokuflow";
export const PUBLIC_DOMAIN = "kiokuflow.net";
export const PUBLIC_ORIGIN = `https://${PUBLIC_DOMAIN}`;
export const LEGACY_DOMAINS = ["gemihub.net", "gemihub.online"] as const;
export const DEFAULT_DRIVE_FOLDER = "kiokuflow";
export const LEGACY_DRIVE_FOLDER = "gemihub";
/** Keep the persisted RAG/index identity while presenting the current brand. */
export function ragSettingDisplayName(name: string): string {
  return name === "gemihub" ? SERVICE_NAME : name;
}

export function isMainAppDomain(host: string, mainDomain = PUBLIC_DOMAIN): boolean {
  const name = host.toLowerCase().replace(/\.$/, "");
  return name === "localhost" || name === "127.0.0.1" || name === "::1"
    || [mainDomain, PUBLIC_DOMAIN, ...LEGACY_DOMAINS].some(domain => name === domain || name === `www.${domain}`);
}

export function isReservedPlatformDomain(host: string, mainDomain = PUBLIC_DOMAIN): boolean {
  const name = host.toLowerCase().replace(/\.$/, "");
  return [mainDomain, PUBLIC_DOMAIN, ...LEGACY_DOMAINS].some(domain => name === domain || name.endsWith(`.${domain}`));
}

export function platformSlug(host: string, mainDomain = PUBLIC_DOMAIN): string | null {
  const name = host.toLowerCase().replace(/\.$/, "");
  for (const domain of [mainDomain, PUBLIC_DOMAIN, ...LEGACY_DOMAINS, "localhost"]) {
    if (!name.endsWith(`.${domain}`)) continue;
    const slug = name.slice(0, -domain.length - 1);
    return slug !== "www" && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) ? slug : null;
  }
  return null;
}
