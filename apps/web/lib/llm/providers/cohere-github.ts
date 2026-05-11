/**
 * PharmIQ — Cohere Embed v3 (GitHub Models)
 *
 * GitHub Models OpenAI-compatible endpoint üzerinden Cohere Embed v3 Multilingual.
 * Free tier: 150 RPD embed tier (Hafta 2 demo PDF ingestion için yeterli).
 *
 * Plan §6.1 — Cohere embed-multilingual-v3, 1024 dim, MIRACL Türkçe lider.
 */

import type {
  EmbeddingInput,
  EmbeddingProvider,
  EmbeddingResult,
  ProviderError,
} from "../types";

const GITHUB_MODELS_BASE = "https://models.github.ai/inference";
const MODEL_ID = "cohere/Cohere-embed-v3-multilingual";
const DIMENSIONS = 1024;
const MAX_BATCH = 96; // Cohere v3 batch limiti

interface CohereEmbedRequest {
  model: string;
  input: string[];
  input_type: "search_document" | "search_query";
  encoding_format?: "float";
}

interface CohereEmbedResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage?: { total_tokens?: number; prompt_tokens?: number };
}

export class CohereGitHubEmbedder implements EmbeddingProvider {
  readonly name = "github-cohere-embed-v3-multilingual" as const;
  readonly maxBatchSize = MAX_BATCH;
  readonly dimensions = DIMENSIONS;

  private readonly token: string;

  constructor(token?: string) {
    const t = token ?? process.env.GITHUB_TOKEN;
    if (!t) {
      throw new Error(
        "[CohereGitHubEmbedder] GITHUB_TOKEN missing in environment"
      );
    }
    this.token = t;
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
        `[CohereGitHubEmbedder] Batch size ${input.texts.length} exceeds ${MAX_BATCH}. ` +
          "Use lib/rag/embedding.ts which handles batching."
      );
    }

    const body: CohereEmbedRequest = {
      model: MODEL_ID,
      input: input.texts,
      input_type: input.inputType,
      encoding_format: "float",
    };

    const res = await fetch(`${GITHUB_MODELS_BASE}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      const err: ProviderError = Object.assign(
        new Error(
          `[CohereGitHubEmbedder] HTTP ${res.status}: ${errorText.slice(0, 500)}`
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

    const data = (await res.json()) as CohereEmbedResponse;

    // index'e göre sırala (API sıra koruyor ama emin olalım)
    const sorted = [...data.data].sort((a, b) => a.index - b.index);
    const embeddings = sorted.map((d) => d.embedding);

    return {
      embeddings,
      provider: this.name,
      model: data.model ?? MODEL_ID,
      dimensions: DIMENSIONS,
      tokenCount: data.usage?.total_tokens,
    };
  }
}

let _instance: CohereGitHubEmbedder | null = null;

export function getCohereEmbedder(): CohereGitHubEmbedder {
  if (!_instance) {
    _instance = new CohereGitHubEmbedder();
  }
  return _instance;
}
