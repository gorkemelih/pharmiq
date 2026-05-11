/**
 * PharmIQ — Gemini Embedding (Google AI Studio)
 *
 * GitHub Models fine-grained PAT OpenAI/Cohere embedding'lerine erişmiyor (403).
 * Google AI Studio free tier ile gemini-embedding-001 kullanıyoruz —
 * variable output_dimensionality (1024 set ederek schema uyumlu).
 *
 * Türkçe için: Gemini multilingual MIRACL benchmark'ında üst sıralarda.
 * Cohere v3 kadar dominant değil ama demo için yeterli.
 *
 * Free tier (Mayıs 2026): 1500 RPM, 1M TPM, çok cömert.
 * Plan §6.1 production'da Cohere Embed v3'e (Azure) geçilir.
 */

import type {
  EmbeddingInput,
  EmbeddingProvider,
  EmbeddingResult,
  ProviderError,
} from "../types";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MODEL_ID = "gemini-embedding-001";
const DIMENSIONS = 1024;
// Gemini batch endpoint günde ~100 request bath gönderebilir,
// her batch'te ~100 content destekler.
const MAX_BATCH = 100;

interface BatchEmbedRequest {
  requests: Array<{
    model: string;
    content: { parts: Array<{ text: string }> };
    task_type: string;
    output_dimensionality: number;
  }>;
}

interface BatchEmbedResponse {
  embeddings: Array<{ values: number[] }>;
}

export class GeminiEmbedder implements EmbeddingProvider {
  readonly name = "github-cohere-embed-v3-multilingual" as const; // type label korundu
  readonly maxBatchSize = MAX_BATCH;
  readonly dimensions = DIMENSIONS;

  private readonly apiKey: string;

  constructor(apiKey?: string) {
    const k = apiKey ?? process.env.GOOGLE_AI_API_KEY;
    if (!k) {
      throw new Error(
        "[GeminiEmbedder] GOOGLE_AI_API_KEY missing in environment"
      );
    }
    this.apiKey = k;
  }

  async embed(input: EmbeddingInput): Promise<EmbeddingResult> {
    if (input.texts.length === 0) {
      return {
        embeddings: [],
        provider: this.name,
        model: MODEL_ID,
        dimensions: DIMENSIONS,
      };
    }
    if (input.texts.length > MAX_BATCH) {
      throw new Error(
        `[GeminiEmbedder] Batch size ${input.texts.length} exceeds ${MAX_BATCH}.`
      );
    }

    const taskType =
      input.inputType === "search_query"
        ? "RETRIEVAL_QUERY"
        : "RETRIEVAL_DOCUMENT";

    const body: BatchEmbedRequest = {
      requests: input.texts.map((text) => ({
        model: `models/${MODEL_ID}`,
        content: { parts: [{ text }] },
        task_type: taskType,
        output_dimensionality: DIMENSIONS,
      })),
    };

    const url = `${API_BASE}/models/${MODEL_ID}:batchEmbedContents?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      const err: ProviderError = Object.assign(
        new Error(
          `[GeminiEmbedder] HTTP ${res.status}: ${errorText.slice(0, 500)}`
        ),
        {
          provider: this.name,
          statusCode: res.status,
          isRateLimit: res.status === 429,
          isTransient: res.status >= 500 || res.status === 429,
        }
      );
      throw err;
    }

    const data = (await res.json()) as BatchEmbedResponse;
    const embeddings = data.embeddings.map((e) => e.values);

    if (embeddings.length !== input.texts.length) {
      throw new Error(
        `[GeminiEmbedder] Length mismatch: requested ${input.texts.length}, got ${embeddings.length}`
      );
    }

    return {
      embeddings,
      provider: this.name,
      model: MODEL_ID,
      dimensions: DIMENSIONS,
    };
  }
}

let _instance: GeminiEmbedder | null = null;

export function getGeminiEmbedder(): GeminiEmbedder {
  if (!_instance) {
    _instance = new GeminiEmbedder();
  }
  return _instance;
}
