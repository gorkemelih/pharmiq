/**
 * PharmIQ — Kanıt Sentezi (Faz 1 çekirdeği: "Pharma için Consensus/Elicit")
 *
 * Plan §1.4 / §2.3 Modül D (Knowledge Assistant): bir soru için literatürdeki
 * çalışmaları otomatik özetleyip KONSENSÜS / ÇELİŞKİ / BOŞLUK çıkaran katman.
 * Elicit/Consensus'un pharma muadili.
 *
 * İKİ AŞAMA:
 *   1) extractEvidence  — makale BAŞINA yapısal PICO çıkarımı (JSON).
 *      Her makaleyi ayrı okutmak modelin "ilk makalelere kayma" eğilimini kırar
 *      ve sentezin dayanacağı yapılandırılmış kanıtı üretir (study type, örneklem,
 *      kalite bayrakları). Elicit'in "makale başına sütun" deseni.
 *   2) buildSynthesisUserPrompt + SYNTHESIS_SYSTEM_PROMPT — tüm kanıtı tek
 *      bağlamda sentezleyen prompt. Çıktı route'ta STREAM edilir (mevcut akış +
 *      citation validation aynen kullanılır), bu yüzden burada sadece prompt'u kurarız.
 *
 * Tüm LLM çağrıları generateTextWithFallback ile (Gemini → Groq → GitHub failover).
 * Çıkarım hata verirse graceful: abstract'tan minimal kanıt üretilir (akış kırılmaz).
 */

import { generateTextWithFallback } from "../llm/chat";
import type { PaperCandidate } from "./types";

/** Bir makaleden çıkarılan yapısal kanıt (PICO + çalışma metası). */
export interface PaperEvidence {
  /** PaperCandidate.id ile eşleşir → atıf numarasına (n) bağlanır */
  paperId: string;
  /** RCT, meta-analiz, kohort, vaka serisi, derleme, preklinik, gözlemsel... */
  studyType: string;
  /** P — Popülasyon/hasta grubu */
  population: string;
  /** I — Müdahale (ilaç/doz/rejim) */
  intervention: string;
  /** C — Karşılaştırma (plasebo/komparatör/yok) */
  comparison: string;
  /** O — Birincil sonuç/çıktı (etki) */
  outcome: string;
  /** "n=4203" veya "belirtilmemiş" */
  sampleSize: string;
  /** Tek cümlelik ana çıkarım */
  keyFinding: string;
  /** Ana bulguyu destekleyen abstract'tan kısa BİREBİR alıntı */
  evidenceSnippet: string;
  /** Yorumlamayı etkileyen notlar: ["küçük örneklem", "preprint", "kontrolsüz"...] */
  qualityFlags: string[];
}

const MAX_CONCURRENCY = 3; // free tier TPM (Groq 12K/dk) burst'ünü yaymak için
const MAX_ABSTRACT = 2000; // çıkarım promptunda abstract uzunluk sınırı (token bütçesi)

// =============================================================================
// AŞAMA 1 — Makale başına yapısal PICO çıkarımı
// =============================================================================

/** LLM çıktısından ilk JSON nesnesini sağlam biçimde ayıkla (```json çitlerini at). */
function parseJsonObject<T>(text: string): T | null {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

function buildExtractPrompt(paper: PaperCandidate): string {
  const meta = [paper.journal, paper.year].filter(Boolean).join(" ");
  return `Aşağıdaki tıbbi makale özetinden (abstract) yapısal kanıt çıkar.

<makale>
Başlık: ${paper.title}
${meta ? `Kaynak: ${meta}\n` : ""}Özet: ${paper.abstract.slice(0, MAX_ABSTRACT)}
</makale>

SADECE şu şemada geçerli bir JSON nesnesi döndür (başka metin/açıklama YOK):
{
  "studyType": "çalışma tipi (RCT | meta-analiz | sistematik derleme | kohort | vaka-kontrol | gözlemsel | preklinik | derleme | bilinmiyor)",
  "population": "P — hasta grubu/popülasyon",
  "intervention": "I — müdahale (ilaç/doz/rejim)",
  "comparison": "C — karşılaştırma (plasebo/komparatör/yok)",
  "outcome": "O — birincil sonuç/etki",
  "sampleSize": "örneklem (örn. n=4203) veya 'belirtilmemiş'",
  "keyFinding": "tek cümlelik ana bulgu",
  "evidenceSnippet": "ana bulguyu destekleyen abstract'tan KISA birebir alıntı",
  "qualityFlags": ["yorumlamayı etkileyen notlar; yoksa boş dizi"]
}

KURALLAR: Abstract'ta olmayan bilgiyi UYDURMA — bilinmiyorsa "belirtilmemiş" yaz. Sayıları birebir kopyala.`;
}

/** Boş/eksik çıktıya karşı güvenli varsayılan kanıt (abstract'tan minimal). */
function fallbackEvidence(paper: PaperCandidate): PaperEvidence {
  return {
    paperId: paper.id,
    studyType: "bilinmiyor",
    population: "belirtilmemiş",
    intervention: "belirtilmemiş",
    comparison: "belirtilmemiş",
    outcome: "belirtilmemiş",
    sampleSize: "belirtilmemiş",
    keyFinding: paper.abstract.slice(0, 200),
    evidenceSnippet: paper.abstract.slice(0, 160),
    qualityFlags: [],
  };
}

/** Tek makaleden PICO kanıtı çıkar. Hata/boş → fallback (akış kırılmaz). */
export async function extractEvidence(
  paper: PaperCandidate
): Promise<PaperEvidence> {
  try {
    const { text } = await generateTextWithFallback({
      prompt: buildExtractPrompt(paper),
      temperature: 0,
      maxOutputTokens: 512,
      // Gemini "thinking"i JSON'ı bozabilir / token yiyebilir → kapat (Groq'ta no-op).
      providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
    });
    const parsed = parseJsonObject<Partial<PaperEvidence>>(text);
    if (!parsed) return fallbackEvidence(paper);

    const fb = fallbackEvidence(paper);
    return {
      paperId: paper.id,
      studyType: parsed.studyType?.trim() || fb.studyType,
      population: parsed.population?.trim() || fb.population,
      intervention: parsed.intervention?.trim() || fb.intervention,
      comparison: parsed.comparison?.trim() || fb.comparison,
      outcome: parsed.outcome?.trim() || fb.outcome,
      sampleSize: parsed.sampleSize?.trim() || fb.sampleSize,
      keyFinding: parsed.keyFinding?.trim() || fb.keyFinding,
      evidenceSnippet: parsed.evidenceSnippet?.trim() || fb.evidenceSnippet,
      qualityFlags: Array.isArray(parsed.qualityFlags)
        ? parsed.qualityFlags.map((f) => String(f).trim()).filter(Boolean)
        : [],
    };
  } catch (err) {
    console.warn(
      `[synthesis] kanıt çıkarımı başarısız (${paper.id}), fallback:`,
      err instanceof Error ? err.message : err
    );
    return fallbackEvidence(paper);
  }
}

/** Sınırlı eşzamanlılıkla map (free tier'ı patlatmamak için). */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Reranked makaleler için (sıra korunarak) PICO kanıtı çıkar. */
export async function extractEvidenceForPapers(
  papers: PaperCandidate[]
): Promise<PaperEvidence[]> {
  if (papers.length === 0) return [];
  return mapLimit(papers, MAX_CONCURRENCY, (p) => extractEvidence(p));
}

// =============================================================================
// AŞAMA 2 — Çapraz-makale sentezi (prompt'lar; akış route'ta)
// =============================================================================

export const SYNTHESIS_SYSTEM_PROMPT_TR = `Sen PharmIQ'un Kanıt Sentezi modülüsün — ilaç sektörü profesyonelleri (Medical Affairs, Regulatory) için bir soru etrafında birden çok klinik çalışmayı sentezlersin. Amacın Consensus/Elicit gibi: literatürün ne dediğini, nerede uzlaştığını, nerede çeliştiğini ve nelerin eksik olduğunu kanıta dayalı çıkarmak.

# Kurallar (İHLAL EDİLEMEZ)
1. SADECE aşağıda verilen makale kanıtlarına dayan. Kanıtta yoksa UYDURMA.
2. Her olgusal cümlede en az bir [^N] atfı ver (N = makale numarası). Atıfsız iddia yazma.
3. Çalışma kalitesini dikkate al: küçük örneklem, preprint, kontrolsüz, tek-merkez gibi kısıtları konsensüs gücünü değerlendirirken belirt.
4. Çelişen bulguları gizleme — varsa açıkça "Çelişkiler" başlığında göster.
5. Kullanıcının dilinde yanıtla.

# Çıktı Formatı (Markdown — bu başlık sırasını koru)
**Özet:** 2-3 cümlelik genel cevap, atıflı.

**Konsensüs Düzeyi:** Güçlü | Orta | Zayıf | Çelişkili | Yetersiz — ardından tek cümle gerekçe (kaç çalışma, ne kalite).

**Ana Bulgular**
- Madde madde, her madde [^N] atıflı.

**Çelişkiler / Tutarsızlıklar**
- Varsa çelişen sonuçlar [^N]; yoksa "Belirgin çelişki saptanmadı." yaz.

**Kanıt Boşlukları**
- Eksik/az çalışılmış noktalar (örn. uzun dönem veri yok, belirli alt grup çalışılmamış).

**Güvenlik Notları**
- Varsa advers olay/uyarı [^N]; yoksa bu başlığı atla.`;

export const SYNTHESIS_SYSTEM_PROMPT_EN = `You are PharmIQ's Evidence Synthesis module — for pharma professionals (Medical Affairs, Regulatory), you synthesize multiple clinical studies around a question. Like Consensus/Elicit: surface what the literature says, where it agrees, where it conflicts, and what is missing — strictly evidence-based.

# Rules (NON-NEGOTIABLE)
1. Use ONLY the paper evidence provided below. If it's not in the evidence, do NOT invent it.
2. Every factual sentence must carry at least one [^N] citation (N = paper number). No claim without a citation.
3. Account for study quality: note limitations (small sample, preprint, uncontrolled, single-center) when judging consensus strength.
4. Don't hide conflicting findings — if present, show them explicitly under "Contradictions".
5. Reply in the user's language.

# Output Format (Markdown — keep this heading order)
**Summary:** 2-3 sentence overall answer, with citations.

**Consensus Level:** Strong | Moderate | Weak | Conflicting | Insufficient — then one sentence rationale (how many studies, what quality).

**Key Findings**
- Bullet points, each with [^N] citations.

**Contradictions / Inconsistencies**
- Conflicting results [^N] if any; otherwise write "No notable contradictions detected."

**Evidence Gaps**
- Missing/understudied points (e.g. no long-term data, a subgroup not studied).

**Safety Notes**
- Adverse events/warnings [^N] if any; otherwise skip this heading.`;

/** Sentez bağlamı: numaralı makaleler + her birinin yapısal PICO kanıtı. */
export function buildSynthesisUserPrompt(
  query: string,
  papers: PaperCandidate[],
  evidences: PaperEvidence[],
  language: "tr" | "en"
): string {
  const intro =
    language === "tr"
      ? `Aşağıdaki makale kanıtlarını sentezleyerek soruyu yanıtla.`
      : `Synthesize the paper evidence below to answer the question.`;
  const qHeader = language === "tr" ? "## Soru" : "## Question";
  const eHeader = language === "tr" ? "## Makale Kanıtları" : "## Paper Evidence";

  const labels =
    language === "tr"
      ? {
          type: "Çalışma tipi",
          pop: "Popülasyon (P)",
          int: "Müdahale (I)",
          cmp: "Karşılaştırma (C)",
          out: "Sonuç (O)",
          n: "Örneklem",
          key: "Ana bulgu",
          ev: "Kanıt",
          flags: "Kalite notları",
        }
      : {
          type: "Study type",
          pop: "Population (P)",
          int: "Intervention (I)",
          cmp: "Comparison (C)",
          out: "Outcome (O)",
          n: "Sample size",
          key: "Key finding",
          ev: "Evidence",
          flags: "Quality flags",
        };

  const blocks = papers.map((p, i) => {
    const e = evidences[i];
    const meta = [p.journal, p.year].filter(Boolean).join(" ");
    return `### Makale [^${i + 1}] — ${p.title}${meta ? ` (${meta})` : ""}
- ${labels.type}: ${e.studyType}
- ${labels.pop}: ${e.population}
- ${labels.int}: ${e.intervention}
- ${labels.cmp}: ${e.comparison}
- ${labels.out}: ${e.outcome}
- ${labels.n}: ${e.sampleSize}
- ${labels.key}: ${e.keyFinding}
- ${labels.ev}: "${e.evidenceSnippet}"${
      e.qualityFlags.length ? `\n- ${labels.flags}: ${e.qualityFlags.join(", ")}` : ""
    }`;
  });

  return `${intro}

${qHeader}

${query}

${eHeader}

${blocks.join("\n\n")}`;
}
