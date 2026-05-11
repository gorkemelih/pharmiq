/**
 * PharmIQ — PDF Parser
 *
 * pdfjs-dist ile sayfa-sayfa metin çıkarma + paragraf segmentation.
 * Plan §5.3 — chunking için section_path + page_number metadata.
 *
 * Bu modül Node.js server-side'da çalışır (next.js API route'tan çağrılır).
 */

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

export interface ParsedPage {
  pageNumber: number;
  text: string;
  paragraphs: ParsedParagraph[];
}

export interface ParsedParagraph {
  index: number;
  text: string;
  charOffsetStart: number;
  charOffsetEnd: number;
  sectionPath?: string;
}

export interface ParsedDocument {
  pageCount: number;
  pages: ParsedPage[];
  fullText: string;
  detectedLanguage?: string;
}

/**
 * PDF buffer'ı sayfa-sayfa parse eder ve her sayfada paragraf segmentation yapar.
 *
 * @param buffer - PDF dosyasının raw bytes'ı
 * @returns Sayfa + paragraf bilgisi içeren parsed document
 */
export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  // pdfjs-dist Node.js'de canvas warning'i çıkarmasın diye disableWorker
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: 0, // suppress console noise
  });

  const pdf = await loadingTask.promise;
  const pages: ParsedPage[] = [];
  let cumulativeOffset = 0;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    // Y koordinatına göre satırları grupla (aynı Y aralığındaki itemler = aynı satır)
    const lines = groupItemsIntoLines(textContent.items as TextItem[]);
    const pageText = lines.map((line) => line).join("\n");

    // Paragraf segmentation: boş satır = paragraf sınırı
    const paragraphs = segmentParagraphs(pageText, cumulativeOffset);
    cumulativeOffset += pageText.length + 1; // +1 for \n between pages

    pages.push({
      pageNumber: i,
      text: pageText,
      paragraphs,
    });
  }

  await pdf.cleanup();

  const fullText = pages.map((p) => p.text).join("\n\n");
  const detectedLanguage = detectLanguage(fullText);

  return {
    pageCount: pdf.numPages,
    pages,
    fullText,
    detectedLanguage,
  };
}

/**
 * Aynı Y koordinatındaki text item'larını birleştirip satır oluşturur.
 * PDF text item'ları genelde kelime/cümle parçaları halinde gelir.
 */
function groupItemsIntoLines(items: TextItem[]): string[] {
  if (items.length === 0) return [];

  const lines: string[][] = [];
  let currentLine: string[] = [];
  let currentY: number | null = null;
  const Y_TOLERANCE = 2; // px

  for (const item of items) {
    const y = item.transform[5];
    if (currentY === null || Math.abs(y - currentY) <= Y_TOLERANCE) {
      currentLine.push(item.str);
      currentY = y;
    } else {
      lines.push(currentLine);
      currentLine = [item.str];
      currentY = y;
    }
  }
  if (currentLine.length > 0) lines.push(currentLine);

  return lines
    .map((parts) => parts.join("").trim())
    .filter((line) => line.length > 0);
}

/**
 * Sayfa metnini paragraf'lara böl. Boş satır veya 2+ \n paragraf sınırıdır.
 * Çok kısa satırlar (örn. başlıklar) ayrı paragraf olarak işaretlenir + sectionPath set'lenir.
 */
function segmentParagraphs(
  pageText: string,
  baseOffset: number
): ParsedParagraph[] {
  const blocks = pageText.split(/\n\s*\n/).filter((b) => b.trim().length > 0);
  const paragraphs: ParsedParagraph[] = [];
  let offset = baseOffset;
  let currentSection: string | undefined;

  blocks.forEach((block, index) => {
    const trimmed = block.replace(/\n/g, " ").trim();
    if (trimmed.length === 0) return;

    // Section heading heuristic: kısa satır + büyük harfle başlar veya numara içerir
    // (örn. "4.1 Indications" gibi SmPC başlıkları)
    const isHeading =
      trimmed.length < 80 &&
      (/^[\d.]+\s+[A-Z]/.test(trimmed) || /^[A-ZÇĞİÖŞÜ][^.!?]{0,60}$/.test(trimmed));

    if (isHeading) {
      currentSection = trimmed;
    }

    paragraphs.push({
      index,
      text: trimmed,
      charOffsetStart: offset,
      charOffsetEnd: offset + trimmed.length,
      sectionPath: currentSection,
    });

    offset += trimmed.length + 2; // +2 for paragraph separator
  });

  return paragraphs;
}

/**
 * Türkçe ve İngilizce için basit karakter-bazlı dil tespiti.
 * Türkçe karakter oranı %2'den fazlaysa TR, değilse EN varsay.
 */
function detectLanguage(text: string): string {
  const sample = text.slice(0, 5000);
  const turkishChars = (sample.match(/[çğıöşüÇĞİÖŞÜ]/g) || []).length;
  const ratio = turkishChars / sample.length;
  return ratio > 0.005 ? "tr" : "en";
}
