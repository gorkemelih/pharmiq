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
import { retrieve, type RetrievedChunk } from "@/lib/rag/retrieval";
import { rerankChunks } from "@/lib/rag/rerank";
import { searchLiterature } from "@/lib/literature/service";
import type { PaperCandidate } from "@/lib/literature/types";
import {
  extractEvidenceForPapers,
  buildSynthesisUserPrompt,
  SYNTHESIS_SYSTEM_PROMPT_TR,
  SYNTHESIS_SYSTEM_PROMPT_EN,
  type PaperEvidence,
} from "@/lib/literature/synthesis";
import { getProviderChain, streamWithProvider } from "@/lib/llm/chat";
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
  /** Belirli dokümanlara kısıtla (belge modu) */
  documentIds?: string[];
  /**
   * "documents"   — yüklenen belgeler (hybrid retrieval)
   * "literature"  — canlı PubMed/Europe PMC Q&A
   * "synthesis"   — canlı literatür + PICO çıkarımı + çapraz-makale sentezi (Consensus/Elicit)
   */
  mode?: "documents" | "literature" | "synthesis";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ChatRequestBody;
    const { messages, documentIds, mode = "documents" } = body;

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

    // Sentez modu da canlı literatüre dayanır (belgeler değil)
    const usesLiterature = mode === "literature" || mode === "synthesis";

    // 1. Kaynak adayları — moda göre (yüklenen belgeler VEYA canlı literatür)
    let candidates: RetrievedChunk[];
    let paperById: Map<string, PaperCandidate> | null = null;
    if (usesLiterature) {
      // Canlı literatür: PubMed/Europe PMC'den çek → chunk-benzeri nesnelere çevir
      const papers = await searchLiterature(query, { limit: 20 });
      paperById = new Map(papers.map((p) => [p.id, p]));
      candidates = papers.map(paperToChunk);
    } else {
      // Belge modu: yüklenen belgelerde hybrid retrieval + RRF (top-20 aday)
      candidates = await retrieve(query, { topK: 20, documentIds });
    }

    // 0-kaynak guard — kaynak yoksa modeli HİÇ çağırma (halüsinasyon imkânsız).
    if (candidates.length === 0) {
      return noSourcesResponse(language, mode);
    }

    // 2. Rerank — adayları alakaya göre yeniden sırala.
    // Sentez: 4 makale (her makale +1 PICO çağrısı → Groq 12K-token/dk burst limitine
    // sığsın; literatür Q&A tek çağrı olduğu için 6). Belge modu: 4.
    const topK = mode === "synthesis" ? 4 : usesLiterature ? 6 : 4;
    const chunks = await rerankChunks(query, candidates, topK);

    // 3. Citation metadata'sı — moda göre (literatürde PMID/DOI/dergi alanları)
    let citations = chunks.map((c, i) => {
      const base = {
        n: i + 1,
        chunkId: c.chunkId,
        documentId: c.documentId,
        documentTitle: c.documentTitle,
        pageNumber: c.pageNumber,
        sectionPath: c.sectionPath,
        score: c.score,
        contentPreview: c.content.slice(0, 240),
      };
      const paper = paperById?.get(c.chunkId);
      if (paper) {
        return {
          ...base,
          kind: "paper" as const,
          contentPreview: paper.abstract.slice(0, 240),
          url: paper.url,
          pmid: paper.pmid,
          doi: paper.doi,
          authors: paper.authors,
          journal: paper.journal,
          year: paper.year,
        };
      }
      return { ...base, kind: "document" as const };
    });

    // 4. System + user prompt (kaynaklar gömülmüş) — moda göre.
    let systemPrompt: string;
    let userPromptWithContext: string;

    if (mode === "synthesis" && paperById) {
      // SENTEZ: reranked makaleler → PICO çıkarımı (paralel) → çapraz-makale sentezi.
      const rerankedPapers = chunks
        .map((c) => paperById!.get(c.chunkId))
        .filter((p): p is PaperCandidate => Boolean(p));
      const evidences = await extractEvidenceForPapers(rerankedPapers);

      // Yapısal kanıtı (çalışma tipi / örneklem / kalite) kaynak kartlarına işle.
      const evidenceById = new Map<string, PaperEvidence>(
        evidences.map((e) => [e.paperId, e])
      );
      citations = citations.map((c) => {
        const e = evidenceById.get(c.chunkId);
        return e
          ? {
              ...c,
              studyType: e.studyType,
              sampleSize: e.sampleSize,
              qualityFlags: e.qualityFlags,
              keyFinding: e.keyFinding,
            }
          : c;
      });

      systemPrompt =
        language === "tr" ? SYNTHESIS_SYSTEM_PROMPT_TR : SYNTHESIS_SYSTEM_PROMPT_EN;
      userPromptWithContext = buildSynthesisUserPrompt(
        query,
        rerankedPapers,
        evidences,
        language
      );
    } else {
      systemPrompt = language === "tr" ? SYSTEM_PROMPT_TR : SYSTEM_PROMPT_EN;
      userPromptWithContext = buildUserPrompt(query, chunks, language);
    }

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
        const providers = getProviderChain();
        const id = "answer";
        let started = false;
        let usedProvider = "";
        let fullText = "";

        // FAILOVER: ilk provider'ı dene; token ÜRETMEDEN hata verirse sıradakine geç.
        // (Akış başladıktan sonra ortada provider değiştiremeyiz.)
        // NOT: streamText hatayı throw ETMEZ → onError ile yakalanır (providerError).
        // Stream boş bittiğinde providerError varsa fırlatıp catch'e düşürüyoruz ki
        // failover sıradaki provider'a geçsin.
        for (const p of providers) {
          let providerError: unknown = null;
          try {
            const result = streamWithProvider(
              p,
              { messages: modelMessages, system: systemPrompt },
              (e) => {
                providerError = e;
              }
            );
            for await (const delta of result.textStream) {
              if (!started) {
                started = true;
                usedProvider = p.name;
                // 'start'ta citations'ı yolla (UI kaynak panelini hemen kurar)
                writer.write({
                  type: "start",
                  messageMetadata: {
                    provider: p.name,
                    retrievedChunkCount: chunks.length,
                    citations,
                    language,
                  },
                });
                writer.write({ type: "text-start", id });
              }
              fullText += delta;
              writer.write({ type: "text-delta", id, delta });
            }
            // Stream throw etmeden boş bittiyse ama onError tetiklendiyse → başarısızlık.
            if (!started && providerError) throw providerError;
            break; // bu provider başarıyla tamamladı (token üretti)
          } catch (err) {
            if (started) throw err; // akış başladı → güvenli geçiş yok
            console.warn(
              `[chat] ${p.name} başarısız, sıradaki provider'a geçiliyor:`,
              err instanceof Error ? err.message.slice(0, 100) : err
            );
          }
        }

        if (!started) throw new Error("Tüm generation provider'ları başarısız");

        writer.write({ type: "text-end", id });
        // Tam metin elimizde → [^N] atıflarını chunk kümesine karşı doğrula
        // (sentez modu: yapısal bölümler atıfsız → mod-farkında eşik)
        const citationValidation = validateCitations(fullText, chunks.length, {
          mode,
        });
        writer.write({
          type: "finish",
          messageMetadata: {
            provider: usedProvider,
            retrievedChunkCount: chunks.length,
            citations,
            language,
            citationValidation,
          },
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
function noSourcesResponse(
  language: "tr" | "en",
  mode: "documents" | "literature" | "synthesis" = "documents"
): Response {
  const message =
    mode === "literature" || mode === "synthesis"
      ? language === "tr"
        ? "Bu soruyla ilgili literatürde (PubMed/Europe PMC) makale bulunamadı. Soruyu farklı ya da daha spesifik ifade edin."
        : "No relevant literature (PubMed/Europe PMC) was found for this question. Try rephrasing or being more specific."
      : language === "tr"
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

/** Literatür makalesini RAG pipeline'ının beklediği RetrievedChunk şekline çevir. */
function paperToChunk(p: PaperCandidate): RetrievedChunk {
  const sectionPath = [p.journal, p.year].filter(Boolean).join(" ");
  return {
    chunkId: p.id,
    documentId: p.id,
    documentTitle: p.title,
    content: `${p.title}\n\n${p.abstract}`,
    language: "en",
    pageNumber: null,
    paragraphIndex: null,
    sectionPath: sectionPath || null,
    score: 0,
    sources: [],
  };
}
