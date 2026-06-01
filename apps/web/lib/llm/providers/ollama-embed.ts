/**
 * PharmIQ — Ollama Embedding (lokal, ücretsiz, sınırsız)
 *
 * Embedding'i Gemini'den alıp lokal Ollama'ya taşıdık → Gemini free-tier kotası
 * embedding'e harcanmaz, generation'a kalır. bge-m3 = 1024-dim (DB şemasıyla birebir).
 *
 * ÖNEMLİ: Model değişti → chunk'lar VE sorgu AYNI modelle gömülmeli. Bu provider'a
 * geçince belge YENİDEN ingest edilmeli (aksi halde elma-armut karşılaştırması → çöp).
 *
 * Ön koşul: Ollama servisi çalışıyor (`brew services start ollama`) + `ollama pull bge-m3`.
 */

import type {
  EmbeddingInput,
  EmbeddingProvider,
  EmbeddingResult,
  ProviderError,
} from "../types";

const DEFAULT_BASE = "http://localhost:11434";
const DIMENSIONS = 1024;
const MAX_BATCH = 64;

interface OllamaEmbedResponse {
  embeddings?: number[][];
}

export class OllamaEmbedder implements EmbeddingProvider {
  readonly name = "ollama-bge-m3" as const;
  readonly maxBatchSize = MAX_BATCH;
  readonly dimensions = DIMENSIONS;

  private readonly baseUrl: string;
  private readonly model: string;

  constructor(opts?: { baseUrl?: string; model?: string }) {
    this.baseUrl = opts?.baseUrl ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE;
    this.model = opts?.model ?? process.env.OLLAMA_EMBED_MODEL ?? "bge-m3";
  }

  async embed(input: EmbeddingInput): Promise<EmbeddingResult> {
    if (input.texts.length === 0) {
      return { embeddings: [], provider: this.name, model: this.model, dimensions: DIMENSIONS };
    }
    if (input.texts.length > MAX_BATCH) {
      throw new Error(`[OllamaEmbedder] Batch ${input.texts.length} > ${MAX_BATCH}`);
    }

    // bge-m3 simetrik: search_query / search_document ayrımına gerek yok → düz göm.
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, input: input.texts }),
      });
    } catch (e) {
      const err: ProviderError = Object.assign(
        new Error(
          `[OllamaEmbedder] Ollama'ya ulaşılamadı (${this.baseUrl}). 'ollama serve' çalışıyor mu? ${
            e instanceof Error ? e.message : String(e)
          }`
        ),
        { provider: this.name, isTransient: true }
      );
      throw err;
    }

    if (!res.ok) {
      const t = await res.text();
      const err: ProviderError = Object.assign(
        new Error(`[OllamaEmbedder] HTTP ${res.status}: ${t.slice(0, 300)}`),
        { provider: this.name, statusCode: res.status, isTransient: res.status >= 500 }
      );
      throw err;
    }

    const data = (await res.json()) as OllamaEmbedResponse;
    const embeddings = data.embeddings ?? [];

    if (embeddings.length !== input.texts.length) {
      throw new Error(
        `[OllamaEmbedder] Length mismatch: istendi ${input.texts.length}, geldi ${embeddings.length}`
      );
    }
    if (embeddings[0]?.length !== DIMENSIONS) {
      throw new Error(
        `[OllamaEmbedder] Beklenen ${DIMENSIONS} boyut, gelen ${embeddings[0]?.length}. DB şeması vector(1024).`
      );
    }

    return { embeddings, provider: this.name, model: this.model, dimensions: DIMENSIONS };
  }
}

let _instance: OllamaEmbedder | null = null;

export function getOllamaEmbedder(): OllamaEmbedder {
  if (!_instance) _instance = new OllamaEmbedder();
  return _instance;
}
