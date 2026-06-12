/**
 * PharmIQ — Generation Provider'ları + Otomatik Failover
 *
 * Zincir (öncelik): Gemini → Groq → GitHub. İlk konfigüre olan birincil;
 * biri hata/limit verirse otomatik SIRADAKİNE geçilir (runtime failover).
 *   - Gemini Flash: büyük günlük token bütçesi → sürdürülebilir birincil, TR güçlü
 *   - Groq (Llama): çok hızlı + ayrı kota → hızlı yedek / burst'ler
 *   - GitHub Models: classic PAT verilirse
 * Embedding ayrı katman (Ollama — lib/rag/embedding.ts).
 *
 * Vercel AI SDK 6: streamText (chat) + generateText (rerank/contextual/eval).
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  streamText,
  generateText,
  type ModelMessage,
  type LanguageModel,
} from "ai";

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
    return { name: "gemini-3-flash", label: "Gemini 3 Flash", isConfigured: false, model: null };
  }
  const google = createGoogleGenerativeAI({ apiKey });
  return {
    name: "gemini-3-flash",
    label: "Gemini 3 Flash",
    isConfigured: true,
    model: google("models/gemini-flash-latest"),
  };
}

function buildGroqProvider(): ChatProvider {
  // Groq = açık modelleri (Llama vb.) ÜCRETSİZ + çok hızlı koşturan servis (≠ Grok/xAI).
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
  return { name: "groq", label: `Groq · ${modelId}`, isConfigured: true, model: provider(modelId) };
}

function buildGitHubProvider(): ChatProvider {
  const token = process.env.GITHUB_MODELS_TOKEN ?? process.env.GITHUB_PAT_CLASSIC;
  if (!token) {
    return { name: "github-gpt-5-mini", label: "GitHub Models · GPT-5 mini", isConfigured: false, model: null };
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

// =============================================================================
// Provider chain + failover
// =============================================================================

let _providers: ChatProvider[] | null = null;

/** Konfigüre provider zinciri, öncelik sırasıyla: Gemini → Groq → GitHub. */
export function getProviderChain(): ChatProvider[] {
  if (_providers) return _providers;
  _providers = [
    buildGeminiProvider(), // sürdürülebilir birincil (büyük günlük bütçe, TR güçlü)
    buildGroqProvider(), // hızlı yedek (ayrı kota)
    buildGitHubProvider(),
  ].filter((p) => p.isConfigured && p.model);
  if (_providers.length === 0) {
    throw new Error(
      "No generation provider configured. Set GOOGLE_AI_API_KEY or GROQ_API_KEY in .env.local"
    );
  }
  return _providers;
}

/** Geriye dönük uyumluluk. */
export function getConfiguredProviders(): ChatProvider[] {
  return getProviderChain();
}

/** Zincirin ilk (birincil) modeli. */
export function getPrimaryModel(): LanguageModel {
  return getProviderChain()[0].model as LanguageModel;
}

export interface StreamChatOptions {
  messages: ModelMessage[];
  system: string;
}

/**
 * Tek bir provider ile stream başlat — route, failover döngüsünde çağırır.
 *
 * ÖNEMLİ: Vercel AI SDK `streamText` hata olduğunda `textStream`'i FIRLATMAZ —
 * hatayı `onError`'a yönlendirip stream'i boş bitirir. Bu yüzden failover'ın
 * çalışması için hatayı `onError` ile yakalayıp çağırana geri veriyoruz; çağıran,
 * stream boş + hata varsa sıradaki provider'a geçer (yoksa Gemini ölünce Groq'a
 * hiç geçilmezdi).
 */
export function streamWithProvider(
  provider: ChatProvider,
  opts: StreamChatOptions,
  onError?: (error: unknown) => void
): ReturnType<typeof streamText> {
  return streamText({
    model: provider.model as LanguageModel,
    system: opts.system,
    messages: opts.messages,
    temperature: 0.2,
    maxOutputTokens: 2048,
    // FAILOVER zinciri dayanıklılığı sağlıyor → provider başına RETRY YAPMA.
    // (Aksi halde ölü/kotası dolu provider'da 3 deneme × backoff = latency ÇARPILIR.)
    // maxRetries:0 → 1 deneme, hata verirse anında sıradaki provider'a geç.
    maxRetries: 0,
    // streamText hatayı throw etmez → buradan yakala (failover sinyali).
    onError: onError ? ({ error }) => onError(error) : undefined,
    // Gemini 3 Flash "thinking"i bazen akışa sızıyor (öz-denetim metni) → kapat.
    // Groq/openai-compatible için no-op (provider-namespaced option).
    providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
  });
}

export interface GenerateFallbackOptions {
  prompt: string;
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  providerOptions?: Parameters<typeof generateText>[0]["providerOptions"];
}

/**
 * Non-streaming generateText — provider zincirinde OTOMATİK FAILOVER.
 * rerank / contextual / eval-judge buradan geçer; biri limit/hata verirse sıradaki.
 */
export async function generateTextWithFallback(
  opts: GenerateFallbackOptions
): Promise<{ text: string; provider: string }> {
  const chain = getProviderChain();
  let lastErr: unknown;
  for (const p of chain) {
    try {
      const { text } = await generateText({
        model: p.model as LanguageModel,
        system: opts.system,
        prompt: opts.prompt,
        temperature: opts.temperature ?? 0.2,
        maxOutputTokens: opts.maxOutputTokens ?? 1024,
        // Zincir failover'ı yapıyor → provider başına retry yok (hızlı geçiş).
        maxRetries: 0,
        providerOptions: opts.providerOptions,
      });
      return { text, provider: p.name };
    } catch (e) {
      lastErr = e;
      console.warn(
        `[llm] ${p.name} başarısız, sıradaki provider'a geçiliyor:`,
        e instanceof Error ? e.message.slice(0, 100) : e
      );
    }
  }
  throw lastErr ?? new Error("Tüm provider'lar başarısız");
}
