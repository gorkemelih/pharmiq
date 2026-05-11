/**
 * PharmIQ — OpenAI text-embedding-3-large (GitHub Models)
 *
 * NOT: Plan'da Cohere Embed v3 multilingual vardı ama GitHub Models katalogunda
 * Cohere embedding modeli YOK (sadece chat: command-r/command-r-plus).
 * Demo için OpenAI text-embedding-3-large @ 1024 dim kullanıyoruz —
 * `dimensions` parametresi ile native 3072'yi 1024'e küçültüyor, schema'mıza uyar.
 *
 * Production'a geçince Azure üzerinden Cohere v3'e geçilecek (plan §6.1).
 * Türkçe için: text-embedding-3-large MIRACL'de fena değil ama Cohere v3 daha iyi.
 *
 * Free tier: 150 RPD embedding tier, 64K token/request.
 */

import type {
  EmbeddingInput,
  EmbeddingProvider,
  EmbeddingResult,
  ProviderError,
} from "../types";

const GITHUB_MODELS_BASE = "https://models.github.ai/inference";
const MODEL_ID = "openai/text-embedding-3-large";
const DIMENSIONS = 1024; // 3072 default → küçültme ile schema uyumlu
const MAX_BATCH = 96; // OpenAI batch limit (Cohere ile aynı tutuyoruz)

interface OpenAIEmbedRequest {
  model: string;
  input: string[];
  dimensions?: number;
  encoding_format?: "float";
}

interface OpenAIEmbedResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage?: { total_tokens?: number; prompt_tokens?: number };
}

export class OpenAIGitHubEmbedder implements EmbeddingProvider {
  readonly name = "github-cohere-embed-v3-multilingual" as const; // type label korundu
  readonly maxBatchSize = MAX_BATCH;
  readonly dimensions = DIMENSIONS;

  private readonly token: string;

  constructor(token?: string) {
    const t = token ?? process.env.GITHUB_TOKEN;
    if (!t) {
      throw new Error(
        "[OpenAIGitHubEmbedder] GITHUB_TOKEN missing in environment"
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
        `[OpenAIGitHubEmbedder] Batch size ${input.texts.length} exceeds ${MAX_BATCH}.`
      );
    }

    // OpenAI Embeddings API'sinde search_document/search_query yok —
    // dimensions parameter ile boyut tutarlılığı sağlanıyor.
    const body: OpenAIEmbedRequest = {
      model: MODEL_ID,
      input: input.texts,
      dimensions: DIMENSIONS,
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
          `[OpenAIGitHubEmbedder] HTTP ${res.status}: ${errorText.slice(0, 500)}`
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

    const data = (await res.json()) as OpenAIEmbedResponse;

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

let _instance: OpenAIGitHubEmbedder | null = null;

export function getDefaultEmbedder(): OpenAIGitHubEmbedder {
  if (!_instance) {
    _instance = new OpenAIGitHubEmbedder();
  }
  return _instance;
}
