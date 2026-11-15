import { getBytes, refererFor } from "./http";
import { bseAlternate } from "./sources/exchange";

export interface PdfDoc {
  bytes: Uint8Array;
  pages: string[]; // text per page; empty strings for scanned pages
  text: string;
}

export function pdfAddresses(url: string): string[] {
  const out = [url];
  const viewer = url.match(/bseindia\.com\/stockinfo\/AnnPdfOpen\.aspx\?Pname=([\w\-]+\.pdf)/i);
  if (viewer) {
    out.push(`https://www.bseindia.com/xml-data/corpfiling/AttachLive/${viewer[1]}`);
    out.push(`https://www.bseindia.com/xml-data/corpfiling/AttachHis/${viewer[1]}`);
  }
  const alt = bseAlternate(url);
  if (alt) out.push(alt);
  return out;
}

const isPdf = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

export async function downloadPdf(url: string): Promise<Uint8Array> {
  const errors: string[] = [];
  for (const u of pdfAddresses(url)) {
    try {
      const bytes = await getBytes(u, { headers: refererFor(u), retries: 2 });
      if (isPdf(bytes)) return bytes;
      errors.push(`not a PDF at ${u.slice(0, 70)}`);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  throw new Error(errors.join(" | "));
}

export async function readPdf(bytes: Uint8Array): Promise<PdfDoc> {
  if (!isPdf(bytes)) {
    throw new Error("Not a PDF (the host returned something else, often a block page)");
  }
  const { extractText, getDocumentProxy } = await import("unpdf");
  // unpdf detaches the buffer it is given, so hand it a copy and keep ours.
  const pdf = await getDocumentProxy(bytes.slice(), { verbosity: 0 });
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [String(text)]).map((p) => p.replace(/[ \t]+/g, " ").trim());
  return { bytes, pages, text: pages.join("\n\n") };
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

// A scanned PDF has pages but almost no extractable text.
export function isScanned(doc: PdfDoc): boolean {
  return doc.text.replace(/\s/g, "").length < Math.max(400, doc.pages.length * 120);
}
