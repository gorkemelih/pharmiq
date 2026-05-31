/**
 * PharmIQ — Embedding Pipeline
 *
 * Chunk listesini alıp Gemini embedding-001 ile 1024-dim vector'lara
 * dönüştürür (Google AI Studio ücretsiz tier). Plan §5.3 Step 2.
 * NOT: Plan Cohere embed-v3 hedefliyor; GitHub Models PAT 403 verdiği için
 * şimdilik Gemini. Cohere = production upgrade (bkz. docs/proje1-mvp-plan.md).
 *
 * - Otomatik batching (embedder.maxBatchSize'a göre).
 * - Rate limit toleransı: 429 alırsa exponential backoff.
 * - Tek bir hata tüm batch'i öldürmesin diye batch-by-batch çağrı.
 */

import { getGeminiEmbedder } from "../llm/providers/gemini-embed";
import type { Chunk } from "./chunking";
import type { EmbeddingProvider, ProviderError } from "../llm/types";

const getDefaultEmbedder = getGeminiEmbedder;

export interface EmbeddedChunk extends Chunk {
  embedding: number[];
}

export interface EmbedOptions {
  /** Override batch size (default 64; embedder.maxBatchSize ile sınırlanır) */
  batchSize?: number;
  /** Override embedder (test/mock için) */
  embedder?: EmbeddingProvider;
  /** Progress callback (UI'da bar göstermek için) */
  onProgress?: (done: number, total: number) => void;
}

const DEFAULT_BATCH_SIZE = 64;
const MAX_RETRIES = 3;

/**
 * Chunks listesini embed eder. Sıralama korunur.
 *
 * @example
 * const embedded = await embedChunks(chunks);
 * // [{ ...chunk1, embedding: [0.12, -0.43, ...] }, ...]
 */
export async function embedChunks(
  chunks: Chunk[],
  options: EmbedOptions = {}
): Promise<EmbeddedChunk[]> {
  if (chunks.length === 0) return [];

  const embedder = options.embedder ?? getDefaultEmbedder();
  const batchSize = Math.min(
    options.batchSize ?? DEFAULT_BATCH_SIZE,
    embedder.maxBatchSize
  );

  const results: EmbeddedChunk[] = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const texts = batch.map((c) => c.content);

    const embeddings = await callWithRetry(() =>
      embedder.embed({ texts, inputType: "search_document" })
    );

    if (embeddings.embeddings.length !== batch.length) {
      throw new Error(
        `[embedChunks] Batch size mismatch: expected ${batch.length}, got ${embeddings.embeddings.length}`
      );
    }

    batch.forEach((chunk, idx) => {
      results.push({ ...chunk, embedding: embeddings.embeddings[idx] });
    });

    options.onProgress?.(results.length, chunks.length);
  }

  return results;
}

/**
 * Tek bir sorgu metnini embed eder ("search_query" mode).
 * Retrieval sırasında kullanılır.
 */
export async function embedQuery(
  query: string,
  options: Pick<EmbedOptions, "embedder"> = {}
): Promise<number[]> {
  const embedder = options.embedder ?? getDefaultEmbedder();
  const result = await callWithRetry(() =>
    embedder.embed({ texts: [query], inputType: "search_query" })
  );
  return result.embeddings[0];
}

async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const pe = err as ProviderError;
      const isRetryable = pe.isTransient ?? false;

      if (!isRetryable || attempt === MAX_RETRIES - 1) break;

      // Exponential backoff: 1s, 2s, 4s
      const delay = Math.pow(2, attempt) * 1000;
      console.warn(
        `[embedding] Retry ${attempt + 1}/${MAX_RETRIES} after ${delay}ms`,
        pe.message
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastErr;
}
