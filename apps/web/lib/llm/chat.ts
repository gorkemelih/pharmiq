/**
 * PharmIQ — Streaming Chat with Provider Fallback
 *
 * Plan §5.2 ADR-001 + ADR-003: provider abstraction with fallback chain.
 *
 * Mayıs 2026 durumu:
 *   - Gemini 3 Flash (Google AI Studio) — ANA, 1M context, 1500 RPM free
 *   - GitHub Models — kullanıcının fine-grained PAT'ı 403 veriyor;
 *     classic PAT verilirse buradan OpenAI/Cohere/Llama eklenir
 *   - Mistral / Groq — Hafta 5'te kullanıcı key alınca eklenir
 *
 * Vercel AI SDK 6 streamText kullanıyor — SSE / UIMessage stream native.
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText, type ModelMessage, type LanguageModel } from "ai";

export interface ChatProvider {
  name: string;
  label: string;
  isConfigured: boolean;
  model: LanguageModel | null;
}

// =============================================================================
// Provider configurations
// =============================================================================

function buildGeminiProvider(): ChatProvider {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return {
      name: "gemini-3-flash",
      label: "Gemini 3 Flash",
      isConfigured: false,
      model: null,
    };
  }
  const google = createGoogleGenerativeAI({ apiKey });
  return {
    name: "gemini-3-flash",
    label: "Gemini 3 Flash",
    isConfigured: true,
    // Mayıs 2026 free tier: "models/gemini-flash-latest" en uygun alias
    model: google("models/gemini-flash-latest"),
  };
}

function buildGitHubProvider(): ChatProvider {
  // Optional: classic PAT verilince aktive olur
  const token = process.env.GITHUB_MODELS_TOKEN ?? process.env.GITHUB_PAT_CLASSIC;
  if (!token) {
    return {
      name: "github-gpt-5-mini",
      label: "GitHub Models · GPT-5 mini",
      isConfigured: false,
      model: null,
    };
  }
  const provider = createOpenAICompatible({
    name: "github-models",
    baseURL: "https://models.github.ai/inference",
    apiKey: token,
  });
  return {
    name: "github-gpt-5-mini",
    label: "GitHub Models · GPT-5 mini",
    isConfigured: true,
    model: provider("openai/gpt-5-mini"),
  };
}

function buildGroqProvider(): ChatProvider {
  // Groq = açık modelleri (Llama vb.) ÜCRETSİZ + çok hızlı koşturan servis.
  // OpenAI-uyumlu API → createOpenAICompatible. Generation'ı buraya alıp
  // Gemini free-tier kotasını koruyoruz. Model env ile seçilir (GROQ_MODEL).
  const apiKey = process.env.GROQ_API_KEY;
  const modelId = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
  if (!apiKey) {
    return { name: "groq", label: `Groq · ${modelId}`, isConfigured: false, model: null };
  }
  const provider = createOpenAICompatible({
    name: "groq",
    baseURL: "https://api.groq.com/openai/v1",
    apiKey,
  });
  return {
    name: "groq",
    label: `Groq · ${modelId}`,
    isConfigured: true,
    model: provider(modelId),
  };
}

// =============================================================================
// Provider chain + fallback
// =============================================================================

let _providers: ChatProvider[] | null = null;

export function getConfiguredProviders(): ChatProvider[] {
  if (_providers) return _providers;
  // Öncelik: Groq (ücretsiz/hızlı) → Gemini → GitHub. İlk konfigüre olan kullanılır.
  _providers = [
    buildGroqProvider(),
    buildGeminiProvider(),
    buildGitHubProvider(),
  ].filter((p) => p.isConfigured);
  if (_providers.length === 0) {
    throw new Error(
      "No chat provider configured. Set GROQ_API_KEY or GOOGLE_AI_API_KEY in .env.local"
    );
  }
  return _providers;
}

/** Eval/yardımcı görevler için ilk konfigüre generation modeli (Groq → Gemini → GitHub). */
export function getPrimaryModel(): LanguageModel {
  const provider = getConfiguredProviders()[0];
  if (!provider.model) throw new Error(`Provider ${provider.name} has no model`);
  return provider.model;
}

export interface StreamChatOptions {
  messages: ModelMessage[];
  system: string;
}

/**
 * Provider zincirini gez; ilk başarılı stream'i döndür.
 * Birinci provider invocation hatası verirse (network/auth/404) sonraki provider'a geç.
 *
 * NOT: streamText lazy başlar — hatalar generally generate sırasında çıkar.
 * İlk read'ten önce provider değiştirmek mümkün değil; bu yüzden burada
 * provider seçimini config'e göre yapıyoruz, runtime fallback değil.
 *
 * Production'da: circuit breaker (last 60s'de 3 fail varsa provider'ı blacklist),
 * "preferred" sticky session, vs. Hafta 5'te eklenecek.
 */
export function streamChat(opts: StreamChatOptions): {
  provider: string;
  result: ReturnType<typeof streamText>;
} {
  const providers = getConfiguredProviders();
  // Şimdilik: sadece ilk konfigüre olmuş provider'ı kullan
  const provider = providers[0];
  if (!provider.model) {
    throw new Error(`Provider ${provider.name} has no model`);
  }

  const result = streamText({
    model: provider.model,
    system: opts.system,
    messages: opts.messages,
    temperature: 0.2,
    maxOutputTokens: 2048,
  });

  return { provider: provider.name, result };
}
