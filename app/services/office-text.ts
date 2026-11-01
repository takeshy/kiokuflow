import { unzipSync } from "fflate";

export function extractOfficeText(path: string, bytes: Uint8Array): string | null {
  if (/\.(doc|xls)$/i.test(path)) throw new Error("Convert legacy Word/Excel files to DOCX/XLSX, PDF or text before indexing.");
  if (!/\.(docx|xlsx|pptx)$/i.test(path)) return null;
  let expanded = 0;
  const files = unzipSync(bytes, { filter: (file) => {
    if (!/^(word\/(document|header\d+|footer\d+)\.xml|xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)|ppt\/slides\/slide\d+\.xml)$/.test(file.name)) return false;
    expanded += file.originalSize;
    if (expanded > 20 * 1024 * 1024) throw new Error("Office document text exceeds 20 MB");
    return true;
  } });
  const decode = (xml: string) => xml.replace(/<\/(?:w:p|a:p|row|si)>/g, "\n").replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const sharedXml = files["xl/sharedStrings.xml"] ? new TextDecoder().decode(files["xl/sharedStrings.xml"]) : "";
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => decode(match[1]).trim());
  return Object.entries(files).filter(([name]) => name !== "xl/sharedStrings.xml").sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([name, data]) => {
    let xml = new TextDecoder().decode(data);
    if (name.startsWith("xl/worksheets/")) xml = xml.replace(/<c\b([^>]*\bt="s"[^>]*)>[\s\S]*?<v>(\d+)<\/v>[\s\S]*?<\/c>/g, (_match, _attrs, index) => ` ${shared[Number(index)] || ""} `);
    return decode(xml);
  }).join("\n\n").trim();
}
