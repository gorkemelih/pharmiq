/**
 * PharmIQ — LLM Provider Tipleri
 *
 * Plan §5.2 ADR-001 (provider abstraction) — her sağlayıcı bu interface'leri implement eder.
 * Round-robin + circuit breaker (lib/llm/rotation.ts) bu tiplere dayanır.
 */

export type ProviderName =
  | "gemini-3-flash"
  | "github-claude-sonnet-4.6"
  | "github-gpt-5-mini"
  | "mistral-large-3"
  | "groq-llama-4-scout";

export type EmbeddingProviderName =
  | "github-cohere-embed-v3-multilingual"
  | "github-cohere-embed-v3-english";

export interface EmbeddingInput {
  texts: string[];
  /** "search_document" for chunks during indexing, "search_query" for queries */
  inputType: "search_document" | "search_query";
}

export interface EmbeddingResult {
  embeddings: number[][];
  provider: EmbeddingProviderName;
  model: string;
  dimensions: number;
  tokenCount?: number;
}

export interface EmbeddingProvider {
  name: EmbeddingProviderName;
  embed(input: EmbeddingInput): Promise<EmbeddingResult>;
  /** Max texts per batch */
  maxBatchSize: number;
  dimensions: number;
}

export interface ProviderError extends Error {
  provider: ProviderName | EmbeddingProviderName;
  statusCode?: number;
  isRateLimit?: boolean;
  isTransient?: boolean;
}
