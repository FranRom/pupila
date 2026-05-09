// CV parsing for the setup-brief flow. Handles PDF (via pdfjs-dist),
// DOCX (via mammoth), and plain markdown / text. Used by both the
// `pnpm run setup-brief` CLI and the UI's `/api/cv` middleware.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type CvFormat = 'pdf' | 'docx' | 'md' | 'txt';

const SUPPORTED_EXTS: Record<string, CvFormat> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.md': 'md',
  '.markdown': 'md',
  '.txt': 'txt',
};

export function detectFormat(filePath: string): CvFormat {
  const ext = path.extname(filePath).toLowerCase();
  const format = SUPPORTED_EXTS[ext];
  if (!format) {
    throw new Error(
      `Unsupported CV format: "${ext}". Supported: .pdf, .docx, .md, .markdown, .txt.`,
    );
  }
  return format;
}

export async function parseCvBuffer(buf: Buffer, format: CvFormat): Promise<string> {
  switch (format) {
    case 'pdf':
      return parsePdf(buf);
    case 'docx':
      return parseDocx(buf);
    case 'md':
    case 'txt':
      return buf.toString('utf-8');
  }
}

export async function parseCvFile(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return parseCvBuffer(buf, detectFormat(filePath));
}

async function parsePdf(buf: Buffer): Promise<string> {
  // Lazy import so users who only paste markdown don't pay the dep cost.
  // Using the legacy build for Node compatibility (no DOM dependencies).
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .filter(Boolean)
      .join(' ');
    pages.push(pageText);
  }
  return pages.join('\n\n').trim();
}

async function parseDocx(buf: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer: buf });
  return result.value.trim();
}
