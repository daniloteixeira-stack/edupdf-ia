import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface ExtractedPdf {
  text: string;
  pageCount: number;
}

/**
 * Extrai o texto do PDF no próprio navegador/app, página por página.
 * Cada página começa com o marcador "[[página N]]", usado depois para
 * gerar questões de um intervalo e para citar a origem.
 */
export async function extractPdfText(file: File, onProgress?: (page: number, total: number) => void): Promise<ExtractedPdf> {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  try {
    const parts: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let line = "";
      const lines: string[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = "";
        } else if (!item.str.endsWith(" ")) {
          line += " ";
        }
      }
      if (line.trim()) lines.push(line);
      const pageText = lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
      parts.push(`[[página ${n}]]\n${pageText}\n`);
      page.cleanup();
      onProgress?.(n, doc.numPages);
    }
    return { text: parts.join("\n"), pageCount: doc.numPages };
  } finally {
    await doc.destroy();
  }
}
