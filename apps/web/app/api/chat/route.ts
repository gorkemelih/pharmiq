/**
 * PharmIQ — POST /api/chat
 *
 * Vercel AI SDK 6 streaming chat endpoint.
 * Flow:
 *   1. Son user mesajını al
 *   2. Hybrid retrieval → top 10 chunk
 *   3. Türkçe/İngilizce sistem promptu + chunks → context
 *   4. streamText (Gemini 3 Flash)
 *   5. UIMessageStreamResponse — client useChat hook'u bunu okur
 *
 * Citations: chunk metadata stream data part olarak gönderilir,
 * client'ta sağ panel ve [^N] chip'leri için kullanılır.
 */

import type { UIMessage } from "ai";
import { convertToModelMessages } from "ai";
import { retrieve } from "@/lib/rag/retrieval";
import { streamChat } from "@/lib/llm/chat";
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

    // 1. Retrieval
    const chunks = await retrieve(query, {
      topK: 10,
      documentIds,
    });

    // 2. System + user prompt (kaynaklar gömülmüş)
    const systemPrompt = language === "tr" ? SYSTEM_PROMPT_TR : SYSTEM_PROMPT_EN;
    const userPromptWithContext = buildUserPrompt(query, chunks, language);

    // Önceki mesajlar (history) + son user mesajının ContextWithSources versiyonu
    // Burada basit yaklaşım: tüm history'yi koruyup, son user mesajını contextli hale getiriyoruz.
    const augmentedMessages = messages.slice(0, -1).concat([
      {
        ...lastUserMsg,
        parts: [{ type: "text", text: userPromptWithContext }],
      },
    ]) as UIMessage[];

    // 3. Stream
    const modelMessages = await convertToModelMessages(augmentedMessages);
    const { provider, result } = streamChat({
      messages: modelMessages,
      system: systemPrompt,
    });

    // 4. UI Message Stream Response — useChat hook tarafından okunur
    return result.toUIMessageStreamResponse({
      // Citations'ı stream data part olarak gönder
      messageMetadata: () => ({
        provider,
        retrievedChunkCount: chunks.length,
        citations: chunks.map((c, i) => ({
          n: i + 1,
          chunkId: c.chunkId,
          documentId: c.documentId,
          documentTitle: c.documentTitle,
          pageNumber: c.pageNumber,
          sectionPath: c.sectionPath,
          score: c.score,
          contentPreview: c.content.slice(0, 240),
        })),
        language,
      }),
    });
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

function extractText(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}
