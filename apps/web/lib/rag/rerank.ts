/**
 * PharmIQ — Rerank (Adım 4)
 *
 * Hybrid retrieval + RRF "kaba elemeci": hızlı ama sıra kaba (anlamca yakın ama
 * soruya tam cevap olmayan parça üste çıkabilir). Rerank "ince elemeci": adayları
 * LLM ile "soruyu ne kadar iyi cevaplıyor?" diye değerlendirip en iyi K'yı seçer.
 *
 * Yöntem: listwise LLM rerank (Groq, ücretsiz). Adaylar numaralı verilir, modelden
 * alaka sırasıyla indeksler istenir, ona göre yeniden dizilir.
 * Graceful: Groq yoksa / hata olursa RRF sırasının ilk K'sı döner (akış kırılmaz).
 *
 * NOT: Pragmatik/ücretsiz yöntem. "Gerçek" cross-encoder reranker (veya kendi
 * fine-tune ettiğin küçük model) production upgrade'i — bkz. wiki [[rerank]].
 */

import { generateTextWithFallback } from "../llm/chat";
import type { RetrievedChunk } from "./retrieval";

const SNIPPET = 320; // her adaydan modele gösterilen metin (token sınırla)

/**
 * Adayları alakaya göre yeniden sıralar, en iyi `topK`'yı döndürür.
 * Sıralama korunur değil — alaka sırasına göre yeniden dizilir.
 */
export async function rerankChunks(
  query: string,
  chunks: RetrievedChunk[],
  topK = 6
): Promise<RetrievedChunk[]> {
  if (chunks.length <= topK) return chunks; // zaten az → rerank gereksiz

  const list = chunks
    .map((c, i) => `[${i}] ${c.content.replace(/\s+/g, " ").slice(0, SNIPPET)}`)
    .join("\n");

  const prompt = `Soru: "${query}"

Aşağıda numaralı aday metin parçaları var. Soruyu yanıtlamak için EN ALAKALI olanları en alakalıdan başlayarak sırala. SADECE indeks numaralarını, alaka sırasıyla, virgülle ayrılmış döndür (örn: 3,0,7). Açıklama YAZMA.

${list}`;

  try {
    const { text } = await generateTextWithFallback({
      prompt,
      temperature: 0,
      maxOutputTokens: 120,
    });

    const order = (text.match(/\d+/g) ?? [])
      .map(Number)
      .filter((i) => Number.isInteger(i) && i >= 0 && i < chunks.length);

    const seen = new Set<number>();
    const reranked: RetrievedChunk[] = [];
    for (const i of order) {
      if (!seen.has(i)) {
        seen.add(i);
        reranked.push(chunks[i]);
      }
    }
    // LLM'in atladığı parçaları (RRF sırasıyla) sona ekle — bilgi kaybı olmasın
    chunks.forEach((c, i) => {
      if (!seen.has(i)) reranked.push(c);
    });

    return reranked.slice(0, topK);
  } catch (err) {
    console.warn(
      "[rerank] başarısız, RRF sırası korunuyor:",
      err instanceof Error ? err.message : err
    );
    return chunks.slice(0, topK);
  }
}
