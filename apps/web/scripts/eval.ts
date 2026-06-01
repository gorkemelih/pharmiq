/**
 * PharmIQ — RAGAS-tarzı Eval (Adım 5)
 *
 * Golden sorularını GERÇEK pipeline'dan (retrieve → rerank → generate) geçirir,
 * 3 metriği Groq-hakem (LLM-as-judge) ile ölçer:
 *   - faithfulness      : cevaptaki iddialar bağlamla destekleniyor mu? (halüsinasyon?)
 *   - answer_relevancy  : cevap soruyu yanıtlıyor mu?
 *   - context_precision : getirilen bağlam soruyla alakalı mı?
 *
 * NOT: Resmi Python `ragas` değil — aynı metrikler, TS-native LLM-judge ile
 * (stack'te kalsın + mantığı görünür olsun diye). Sonuç → eval/results.json.
 *
 * Kullanım: pnpm eval   (ön koşul: db açık + Ollama + Groq key .env.local'da)
 */

import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "..", ".env.local") });

import { readFileSync, writeFileSync } from "node:fs";
import { generateText } from "ai";
import { retrieve } from "../lib/rag/retrieval";
import { rerankChunks } from "../lib/rag/rerank";
import { getPrimaryModel } from "../lib/llm/chat";
import {
  SYSTEM_PROMPT_TR,
  SYSTEM_PROMPT_EN,
  buildUserPrompt,
  detectQueryLanguage,
} from "../lib/llm/prompts";

interface GoldenItem {
  id: string;
  lang: string;
  question: string;
}

/** Groq free-tier rate limit'ine (429) karşı exponential backoff'lu yeniden dene. */
async function retry<T>(fn: () => Promise<T>, label: string, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const wait = 3000 * (i + 1);
      console.warn(
        `  ⚠ ${label} retry ${i + 1}/${tries} (${wait}ms): ${
          e instanceof Error ? e.message.slice(0, 80) : e
        }`
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

/** Gerçek pipeline'la cevap üret (chat route ile aynı: retrieve → rerank → generate). */
async function answerFor(question: string) {
  const lang = detectQueryLanguage(question);
  const candidates = await retrieve(question, { topK: 20 });
  const chunks = await rerankChunks(question, candidates, 6);
  const system = lang === "tr" ? SYSTEM_PROMPT_TR : SYSTEM_PROMPT_EN;
  const prompt = buildUserPrompt(question, chunks, lang);
  const { text } = await retry(
    () =>
      generateText({
        model: getPrimaryModel(),
        system,
        temperature: 0.2,
        maxOutputTokens: 1024,
        prompt,
      }),
    "generate"
  );
  return { chunks, answer: text };
}

/** Tek bir 0..1 puanı için LLM-hakem. */
async function judgeScore(task: string): Promise<number> {
  const { text } = await retry(
    () =>
      generateText({
        model: getPrimaryModel(),
        temperature: 0,
        maxOutputTokens: 12,
        prompt: `${task}\n\nSADECE 0.0 ile 1.0 arası TEK bir ondalık sayı döndür (örn: 0.85). Başka hiçbir şey yazma.`,
      }),
    "judge"
  );
  const m = text.match(/\d*\.?\d+/);
  return m ? Math.max(0, Math.min(1, parseFloat(m[0]))) : 0;
}

function contextBlock(chunks: { content: string }[]): string {
  return chunks
    .map((c, i) => `[${i + 1}] ${c.content.replace(/\s+/g, " ").slice(0, 600)}`)
    .join("\n\n");
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

async function main() {
  const golden: GoldenItem[] = JSON.parse(
    readFileSync(resolve(__dirname, "..", "eval", "golden.json"), "utf8")
  );
  console.log(`\nPharmIQ RAGAS-tarzı eval — ${golden.length} soru\n`);

  const rows: Array<{
    id: string;
    lang: string;
    faithfulness: number;
    answer_relevancy: number;
    context_precision: number;
  }> = [];

  for (const g of golden) {
    const { chunks, answer } = await answerFor(g.question);
    const ctx = contextBlock(chunks);

    const faithfulness = await judgeScore(
      `Bağlam parçaları:\n${ctx}\n\nCevap:\n${answer}\n\nGörev (faithfulness): Cevaptaki iddiaların ne kadarlık oranı yukarıdaki bağlamla DESTEKLENİYOR?`
    );
    const answer_relevancy = await judgeScore(
      `Soru: ${g.question}\n\nCevap:\n${answer}\n\nGörev (answer relevancy): Cevap soruyu ne kadar iyi ve doğrudan yanıtlıyor?`
    );
    const context_precision = await judgeScore(
      `Soru: ${g.question}\n\nGetirilen bağlam parçaları:\n${ctx}\n\nGörev (context precision): Bu parçaların ne kadarlık oranı soruyla GERÇEKTEN alakalı?`
    );

    rows.push({ id: g.id, lang: g.lang, faithfulness, answer_relevancy, context_precision });
    console.log(
      `${g.id} [${g.lang}]  faith=${faithfulness.toFixed(2)}  relev=${answer_relevancy.toFixed(2)}  ctxP=${context_precision.toFixed(2)}  | ${g.question.slice(0, 48)}`
    );
  }

  const summary = {
    n: rows.length,
    faithfulness: +mean(rows.map((r) => r.faithfulness)).toFixed(3),
    answer_relevancy: +mean(rows.map((r) => r.answer_relevancy)).toFixed(3),
    context_precision: +mean(rows.map((r) => r.context_precision)).toFixed(3),
  };

  console.log(`\n=== ORTALAMA (n=${summary.n}) ===`);
  console.log(`faithfulness     : ${summary.faithfulness}`);
  console.log(`answer_relevancy : ${summary.answer_relevancy}`);
  console.log(`context_precision: ${summary.context_precision}\n`);

  writeFileSync(
    resolve(__dirname, "..", "eval", "results.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2)
  );
  console.log("→ eval/results.json yazıldı");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
