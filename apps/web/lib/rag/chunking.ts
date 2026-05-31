/**
 * PharmIQ — Chunking Module
 *
 * Plan §5.3'ten — paragraf-aware recursive chunking, ~512 token target.
 * Türkçe medical text için tasarlandı: SmPC bölüm bilgisini koruyor.
 *
 * Strateji:
 * 1. Parser'dan gelen paragraf'ları base unit olarak kullan.
 * 2. Çok uzun paragrafları cümle bazında böl.
 * 3. Komşu kısa paragrafları (örn. başlık + ilk cümle) birleştir.
 * 4. Her chunk ~256-512 token — küçük chunk = daha isabetli retrieval (~384 tatlı nokta).
 *
 * Token tahmini: Türkçe ortalama ~3 karakter/token (İngilizce ~4).
 */

import type { ParsedDocument, ParsedParagraph } from "../pdf/parser";

export interface Chunk {
  content: string;
  pageNumber: number;
  paragraphIndex: number;
  charOffsetStart: number;
  charOffsetEnd: number;
  sectionPath?: string;
  language: string;
}

export interface ChunkingOptions {
  /** Hedef chunk token sayısı (varsayılan 384) */
  targetTokens?: number;
  /** Maksimum chunk token sayısı (retrieval granülaritesi için ~512 üst sınır) */
  maxTokens?: number;
  /** Minimum chunk token sayısı (çok küçük chunk birleştirilsin) */
  minTokens?: number;
}

const DEFAULT_OPTIONS: Required<ChunkingOptions> = {
  targetTokens: 384,
  maxTokens: 480, // ~512 hedef üst sınır; güvenlik payı için 480
  minTokens: 80,
};

/**
 * Yaklaşık token sayısı tahmini.
 * Türkçe için karakter/3, İngilizce için karakter/4 yaklaşımı yeterli (±%15).
 */
export function estimateTokens(text: string, language: string = "tr"): number {
  const divisor = language === "tr" ? 3 : 4;
  return Math.ceil(text.length / divisor);
}

/**
 * Parsed document'ı chunk'lara böler.
 * Section heading'leri koruyarak paragraf akışını izler.
 */
export function chunkDocument(
  doc: ParsedDocument,
  options: ChunkingOptions = {}
): Chunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const language = doc.detectedLanguage ?? "tr";
  const chunks: Chunk[] = [];

  let buffer: ParsedParagraph[] = [];
  let bufferTokens = 0;
  let bufferPage = 1;

  const flush = () => {
    if (buffer.length === 0) return;
    const content = buffer
      .map((p) => (p.sectionPath ? `[${p.sectionPath}] ${p.text}` : p.text))
      .join("\n\n");

    chunks.push({
      content,
      pageNumber: bufferPage,
      paragraphIndex: buffer[0].index,
      charOffsetStart: buffer[0].charOffsetStart,
      charOffsetEnd: buffer[buffer.length - 1].charOffsetEnd,
      sectionPath: buffer.find((p) => p.sectionPath)?.sectionPath,
      language,
    });

    buffer = [];
    bufferTokens = 0;
  };

  for (const page of doc.pages) {
    for (const para of page.paragraphs) {
      const paraTokens = estimateTokens(para.text, language);

      // Çok uzun paragraf — kendi başına böl
      if (paraTokens > opts.maxTokens) {
        if (buffer.length > 0) flush();
        const subChunks = splitLongParagraph(para, opts, language, page.pageNumber);
        chunks.push(...subChunks);
        continue;
      }

      // Buffer'a eklerken limit aşılır mı?
      if (
        bufferTokens + paraTokens > opts.targetTokens &&
        bufferTokens >= opts.minTokens
      ) {
        flush();
      }

      if (buffer.length === 0) {
        bufferPage = page.pageNumber;
      }
      buffer.push(para);
      bufferTokens += paraTokens;

      if (bufferTokens >= opts.maxTokens) {
        flush();
      }
    }
  }

  flush();
  return chunks;
}

/**
 * Çok uzun bir paragrafı cümle bazında parçalara ayır.
 */
function splitLongParagraph(
  para: ParsedParagraph,
  opts: Required<ChunkingOptions>,
  language: string,
  pageNumber: number
): Chunk[] {
  // Türkçe + İngilizce için ortak cümle sonu pattern'i
  const sentences = para.text
    .split(/(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ])/)
    .filter((s) => s.trim().length > 0);

  const chunks: Chunk[] = [];
  let buffer: string[] = [];
  let bufferTokens = 0;
  let charOffset = para.charOffsetStart;

  for (const sentence of sentences) {
    const sTokens = estimateTokens(sentence, language);

    if (bufferTokens + sTokens > opts.targetTokens && buffer.length > 0) {
      const content = buffer.join(" ");
      chunks.push({
        content: para.sectionPath ? `[${para.sectionPath}] ${content}` : content,
        pageNumber,
        paragraphIndex: para.index,
        charOffsetStart: charOffset,
        charOffsetEnd: charOffset + content.length,
        sectionPath: para.sectionPath,
        language,
      });
      charOffset += content.length + 1;
      buffer = [];
      bufferTokens = 0;
    }

    buffer.push(sentence);
    bufferTokens += sTokens;
  }

  if (buffer.length > 0) {
    const content = buffer.join(" ");
    chunks.push({
      content: para.sectionPath ? `[${para.sectionPath}] ${content}` : content,
      pageNumber,
      paragraphIndex: para.index,
      charOffsetStart: charOffset,
      charOffsetEnd: charOffset + content.length,
      sectionPath: para.sectionPath,
      language,
    });
  }

  return chunks;
}
