/**
 * PharmIQ — Off-Label Claim Detector
 *
 * Plan §12 — MLR compliance: pharma cevap üretildikten sonra "bu cümle
 * onaylı endikasyon dışı bir kullanım iddiası mı?" sınıflandırması.
 *
 * Strateji:
 *   1. Hızlı rule-based skip: cevap kısa/içeriksizse atla
 *   2. LLM judge (Gemini Flash, low temp, structured JSON) ile sınıflandır
 *   3. confidence > 0.7 → UI'da kırmızı uyarı
 *
 * Önemli: judge model retrieval chunk'larını DA görür — "kaynaklarda bu
 * kullanım onaylı endikasyon olarak listelenmiş mi?" diye bakar.
 */

import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import type { RetrievedChunk } from "../rag/retrieval";

const OffLabelResult = z.object({
  detected: z
    .boolean()
    .describe(
      "TRUE only if the answer explicitly recommends/implies a use that is NOT in the sources' approved indications list. FALSE if uncertain or if sources lack indication info."
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("0-1 — model's certainty about the detected flag"),
  reason: z
    .string()
    .describe(
      "1-2 sentence explanation in the same language as the answer (TR or EN). Quote the suspect phrase if possible."
    ),
  suspectQuote: z
    .string()
    .nullable()
    .describe(
      "The exact phrase from the answer that triggered the flag, or null"
    ),
});

export type OffLabelDetection = z.infer<typeof OffLabelResult>;

const JUDGE_SYSTEM_PROMPT = `You are an MLR (Medical Legal Regulatory) compliance reviewer for a pharma RAG system. Your job: read an AI-generated answer + the sources it cited, and decide whether the answer makes an off-label claim.

OFF-LABEL = the answer recommends or implies the use of a drug for an indication, population, dose, or route that is NOT listed as approved in the provided source chunks.

Rules:
- ONLY flag if the answer makes a positive recommendation/claim outside the approved indications visible in sources.
- DO NOT flag merely discussing/comparing studies even if they explore unapproved uses, unless the answer recommends them.
- DO NOT flag if sources don't mention indication info (you can't infer off-label without an approved list).
- DO NOT flag the warning text itself.
- Be CONSERVATIVE: when in doubt, return detected=false with low confidence.

Reply in the language of the answer.`;

interface JudgeArgs {
  question: string;
  answer: string;
  chunks: Pick<RetrievedChunk, "content" | "sectionPath" | "documentTitle">[];
  language?: "tr" | "en";
}

/**
 * Run the off-label judge on a completed answer.
 * Returns detection result with confidence + reason.
 *
 * Fail-open: judge call failure → returns detected=false (don't block UI).
 */
export async function detectOffLabel({
  question,
  answer,
  chunks,
  language = "tr",
}: JudgeArgs): Promise<OffLabelDetection> {
  // Hızlı rule-based skip: çok kısa cevap genelde "bilgi yok" cevabıdır
  if (answer.trim().length < 80) {
    return {
      detected: false,
      confidence: 0.95,
      reason:
        language === "tr"
          ? "Cevap çok kısa, off-label iddia içermez."
          : "Answer too short to contain claims.",
      suspectQuote: null,
    };
  }

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return {
      detected: false,
      confidence: 0,
      reason: "Judge unavailable (no API key)",
      suspectQuote: null,
    };
  }

  const google = createGoogleGenerativeAI({ apiKey });

  const sourcesBlock = chunks
    .slice(0, 8) // judge için daha az chunk, hızlı dönsün
    .map(
      (c, i) =>
        `Source [${i + 1}] (${c.documentTitle}${
          c.sectionPath ? `, ${c.sectionPath}` : ""
        }):\n${c.content.slice(0, 600)}`
    )
    .join("\n\n");

  const userPrompt = `## User question
${question}

## Sources the answer cites
${sourcesBlock}

## AI Answer to review
${answer}

Now decide: does this answer make an off-label claim per the rules?`;

  try {
    const { object } = await generateObject({
      model: google("models/gemini-flash-latest"),
      schema: OffLabelResult,
      system: JUDGE_SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0.1, // kararlı
    });
    return object;
  } catch (err) {
    console.warn("[off-label judge] failed, defaulting to not detected:", err);
    return {
      detected: false,
      confidence: 0,
      reason: "Judge call failed",
      suspectQuote: null,
    };
  }
}
