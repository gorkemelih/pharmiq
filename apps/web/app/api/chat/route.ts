/**
 * PharmIQ — POST /api/chat
 *
 * Vercel AI SDK 6 streaming chat endpoint.
 * Flow:
 *   1. Son user mesajını al
 *   2. Hybrid retrieval → top 10 chunk
 *   3. 0-chunk guard: kaynak yoksa modeli ÇAĞIRMA (halüsinasyon imkânsız)
 *   4. Türkçe/İngilizce sistem promptu + chunks → context
 *   5. streamText (Gemini 3 Flash) → text delta'larını elle akıt
 *   6. Tam metin oluşunca [^N] atıflarını doğrula → 'finish' metadata'sına ekle
 *   7. UIMessageStreamResponse — client useChat hook'u bunu okur
 *
 * NOT (öğrenme): streamText.onFinish ile finish-metadata'nın SIRASI garanti
 * değil (denedik, doğrulama metadata'ya düşmedi). Bu yüzden createUIMessageStream
 * ile akışı elle yönetiyoruz: text bitince doğrulayıp 'finish'i biz yazıyoruz.
 *
 * Citations: chunk metadata 'start'ta gönderilir (sağ panel + [^N] chip'leri).
 * Doğrulama: [^N]'ler chunk kümesine karşı denetlenir (bkz. lib/llm/citations.ts).
 */

import type { UIMessage } from "ai";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";
import { retrieve } from "@/lib/rag/retrieval";
import { rerankChunks } from "@/lib/rag/rerank";
import { streamChat } from "@/lib/llm/chat";
import { validateCitations } from "@/lib/llm/citations";
import {
  SYSTEM_PROMPT_TR,
  SYSTEM_PROMPT_EN,
  buildUserPrompt,
  detectQueryLanguage,
} from "@/lib/llm/prompts";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ChatRequestBody {
  messages: UIMessage[];
  /** Belirli dokümanlara kısıtla */
  documentIds?: string[];
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ChatRequestBody;
    const { messages, documentIds } = body;

    if (!messages?.length) {
      return new Response(JSON.stringify({ error: "messages required" }), {
        status: 400,
      });
    }

    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) {
      return new Response(JSON.stringify({ error: "no user message" }), {
        status: 400,
      });
    }

    const query = extractText(lastUserMsg);
    const language = detectQueryLanguage(query);

    // 1. Retrieval — geniş aday havuzu (RRF top-20)
    const candidates = await retrieve(query, {
      topK: 20,
      documentIds,
    });

    // 0-chunk guard — kaynak yoksa modeli HİÇ çağırma (MLR: halüsinasyon imkânsız).
    if (candidates.length === 0) {
      return noSourcesResponse(language);
    }

    // 2. Rerank — adayları alakaya göre yeniden sırala, en iyi 6 (Groq; yoksa RRF sırası)
    const chunks = await rerankChunks(query, candidates, 6);

    // 3. Citation metadata'sı: her chunk numaralı (UI chip + kaynak paneli için)
    const citations = chunks.map((c, i) => ({
      n: i + 1,
      chunkId: c.chunkId,
      documentId: c.documentId,
      documentTitle: c.documentTitle,
      pageNumber: c.pageNumber,
      sectionPath: c.sectionPath,
      score: c.score,
      contentPreview: c.content.slice(0, 240),
    }));

    // 4. System + user prompt (kaynaklar gömülmüş)
    const systemPrompt = language === "tr" ? SYSTEM_PROMPT_TR : SYSTEM_PROMPT_EN;
    const userPromptWithContext = buildUserPrompt(query, chunks, language);

    // Önceki history korunur; son user mesajı context'li versiyonuyla değiştirilir.
    const augmentedMessages = messages.slice(0, -1).concat([
      {
        ...lastUserMsg,
        parts: [{ type: "text", text: userPromptWithContext }],
      },
    ]) as UIMessage[];
    const modelMessages = await convertToModelMessages(augmentedMessages);

    // 5+6. Akışı elle yönet: text delta'larını akıt, tam metin oluşunca doğrula.
    const stream = createUIMessageStream({
      onError: (e) => (e instanceof Error ? e.message : "stream error"),
      execute: async ({ writer }) => {
        const { provider, result } = streamChat({
          messages: modelMessages,
          system: systemPrompt,
        });

        const base = {
          provider,
          retrievedChunkCount: chunks.length,
          citations,
          language,
        };

        const id = "answer";
        // 'start'ta citations'ı yolla (önden bilinir → UI kaynak panelini hemen kurar)
        writer.write({ type: "start", messageMetadata: base });
        writer.write({ type: "text-start", id });

        // Model'in token'larını akıt + tam metni biriktir
        let fullText = "";
        for await (const delta of result.textStream) {
          fullText += delta;
          writer.write({ type: "text-delta", id, delta });
        }
        writer.write({ type: "text-end", id });

        // Artık tam metin elimizde → [^N] atıflarını chunk kümesine karşı doğrula
        const citationValidation = validateCitations(fullText, chunks.length);
        writer.write({
          type: "finish",
          messageMetadata: { ...base, citationValidation },
        });
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (err) {
    console.error("[POST /api/chat]", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "chat failed",
      }),
      { status: 500 }
    );
  }
}

/**
 * Retrieval 0 chunk döndürdüğünde: modeli çağırmadan sabit "kaynak yok" yanıtı stream'le.
 * createUIMessageStream ile UI message chunk'larını elle yazıyoruz (LLM yok = sıfır halüsinasyon).
 */
function noSourcesResponse(language: "tr" | "en"): Response {
  const message =
    language === "tr"
      ? "Bu konuda sağlanan kaynaklarda yeterli bilgi yok. Lütfen soruyu daha spesifik sorun ya da ilgili belgeyi kütüphaneye yükleyin."
      : "The provided sources don't contain enough information on this topic. Please ask a more specific question or upload the relevant document.";

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      const id = "no-sources";
      writer.write({
        type: "start",
        messageMetadata: {
          provider: "none",
          retrievedChunkCount: 0,
          citations: [],
          language,
          noSources: true,
        },
      });
      writer.write({ type: "text-start", id });
      writer.write({ type: "text-delta", id, delta: message });
      writer.write({ type: "text-end", id });
      writer.write({ type: "finish" });
    },
  });

  return createUIMessageStreamResponse({ stream });
}

function extractText(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}
