/**
 * PharmIQ — Contextual Chunking (Adım 3)
 *
 * Her chunk'a, gömmeden ÖNCE LLM ile üretilen kısa bir "bağlam cümlesi" ekler ki
 * parça kendi kendine yetsin → embedding keskinleşir → retrieval isabeti artar.
 * (Anthropic "Contextual Retrieval" deseni; retrieval hatalarını ~%35-49 azaltır.)
 *
 * ÖNEMLİ tasarım kararı: bağlam SADECE embedding metnine eklenir. Saklanan chunk
 * içeriği (content) VERBATIM kalır — pharma/MLR'de atıf birebir kaynağa izlenmeli.
 *
 * Maliyet: ingest sırasında chunk başına 1 ekstra LLM çağrısı (sorgu başına DEĞİL).
 * Belge metni bir kez hazırlanıp her chunk'a verilir. Anahtar yoksa / hata olursa
 * graceful: bağlam boş kalır, yapısal chunking gibi davranır (ingest kırılmaz).
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import type { ParsedDocument } from "../pdf/parser";
import type { Chunk } from "./chunking";

export interface ContextualizedChunk {
  chunk: Chunk;
  /** LLM'in ürettiği konumlandırıcı bağlam; üretilemezse "" */
  contextHeader: string;
}

const MODEL_ID = "models/gemini-flash-latest";
const MAX_DOC_CHARS = 12000; // bağlam üretimi için belge metnini sınırla (maliyet)
const MAX_CONCURRENCY = 4; // free tier'ı zorlamadan paralel üret

function getModel() {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return null;
  return createGoogleGenerativeAI({ apiKey })(MODEL_ID);
}

/** Parsed belgeyi bağlam üretimi için düz metne indir (sınırlı uzunluk). */
function docToText(doc: ParsedDocument): string {
  return doc.pages
    .flatMap((p) => p.paragraphs.map((par) => par.text))
    .join("\n")
    .slice(0, MAX_DOC_CHARS);
}

function buildPrompt(docText: string, chunk: string): string {
  return `<belge>
${docText}
</belge>

Yukarıdaki belgeden bir parça (chunk):
<parca>
${chunk}
</parca>

Bu parçayı belge içinde KONUMLANDIRAN, aramada bulunmasını kolaylaştıracak KISA bir bağlam yaz (TEK cümle, en fazla 25 kelime). Belgenin/parçanın dilinde yaz. SADECE bağlam cümlesini döndür — başlık, tırnak veya açıklama ekleme.`;
}

/** Sınırlı eşzamanlılıkla map (free tier'ı patlatmamak için). */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
}

/**
 * Her chunk için kısa bağlam üretir. Sıralama korunur.
 * Anahtar yoksa hepsi boş header ile döner (graceful → yapısal chunking).
 */
export async function contextualizeChunks(
  doc: ParsedDocument,
  chunks: Chunk[]
): Promise<ContextualizedChunk[]> {
  const model = getModel();
  if (!model || chunks.length === 0) {
    return chunks.map((chunk) => ({ chunk, contextHeader: "" }));
  }

  const docText = docToText(doc);

  return mapLimit(chunks, MAX_CONCURRENCY, async (chunk, idx) => {
    try {
      const { text } = await generateText({
        model,
        temperature: 0.1,
        maxOutputTokens: 256,
        // Gemini 3 Flash'ın "thinking"i token bütçesini yiyip cevabı kesiyordu
        // (+ kotayı şişiriyordu). Basit tek-cümle görev → thinking'i kapat.
        providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
        prompt: buildPrompt(docText, chunk.content),
      });
      const header = text.trim().replace(/\s+/g, " ");
      if (idx < 2) {
        console.log(`[contextual] chunk ${idx} → "${header.slice(0, 120)}"`);
      }
      return { chunk, contextHeader: header };
    } catch (err) {
      console.warn(
        `[contextual] chunk ${idx} bağlam üretilemedi, boş geçiliyor:`,
        err instanceof Error ? err.message : err
      );
      return { chunk, contextHeader: "" };
    }
  });
}

/** Embedding'e verilecek metin: bağlam + verbatim içerik. Bağlam yoksa sadece içerik. */
export function buildEmbedText(c: ContextualizedChunk): string {
  return c.contextHeader
    ? `${c.contextHeader}\n\n${c.chunk.content}`
    : c.chunk.content;
}
