/** Daily Timeline files share a name across browsers and devices. */
export function isTimelineDayPath(name: string): boolean {
  return /^Dashboards\/Timeline\/.+\/\d{4}-\d{2}-\d{2}\.md$/.test(name)
    && !name.includes("\\") && !name.includes("\0")
    && !name.split("/").some(part => !part || part === "." || part === "..");
}
