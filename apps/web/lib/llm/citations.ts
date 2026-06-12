/**
 * PharmIQ — Citation Doğrulama (hibrit kararın 1. ayağı)
 *
 * SORUN: LLM cevabına [^N] atıfları koyuyor ama N gerçekten retrieve edilmiş bir
 * chunk'a denk geliyor mu, yoksa model uydurdu mu — hiç kontrol edilmiyordu.
 * MLR (ilaç regülasyon) bağlamında uydurma/yanlış atıf kabul EDİLEMEZ.
 *
 * BU MODÜL cevabı kaynağa karşı YAPISAL doğrular:
 *   - [^N] işaretlerini çıkar
 *   - N geçerli aralıkta mı (1..chunkCount) → aralık dışı = model uydurdu
 *   - cümle kapsamı: kaç cümle atıfsız → "her cümle kaynaklı" kuralını denetle
 *
 * KAPSAM DIŞI (bilerek): "Chunk iddiayı GERÇEKTEN destekliyor mu" (semantik
 * faithfulness) → RAGAS adımında (Adım 5) gelecek. Karakter-seviyesi garantili
 * grounding → Claude Citations API, production upgrade (docs/proje1-mvp-plan.md).
 */

export interface CitationValidation {
  /** Cevapta geçen tüm benzersiz atıf numaraları (sıralı) */
  citedNumbers: number[];
  /** Geçerli aralıktaki (1..chunkCount) atıflar */
  valid: number[];
  /** Aralık dışı atıflar = model uydurdu (örn. 5 chunk varken [^8]) */
  invalid: number[];
  /** Cevabın referans verdiği FARKLI geçerli chunk sayısı */
  distinctChunksUsed: number;
  /** Toplam "iddia" cümlesi (kaba tahmin) */
  totalSentences: number;
  /** Atıf içermeyen cümle sayısı (kapsam açığı) */
  uncitedSentences: number;
  /** 0..1 — atıflı cümle oranı */
  coverage: number;
  /** Doğrulama geçti mi: uydurma atıf yok + en az 1 geçerli + kapsam eşik üstü */
  ok: boolean;
}

// /g flag → matchAll için (tüm eşleşmeleri yakala). Capture grubu = numara.
const CITATION_GLOBAL = /\[\^(\d+)\]/g;
// /g YOK → .test() için güvenli (global regex .test() lastIndex tutar = bug kaynağı).
const HAS_CITATION = /\[\^\d+\]/;

// Belge/literatür modu: "her cümle kaynaklı" → yüksek eşik.
// Sentez modu: yapısal bölümler (Kanıt Boşlukları, "çelişki yok", konsensüs gerekçesi)
// doğal olarak atıfsız (kaynaktan iddia değil, kanıt manzarası) → daha düşük eşik.
const COVERAGE_THRESHOLD_DEFAULT = 0.6;
const COVERAGE_THRESHOLD_SYNTHESIS = 0.5;

/** Salt markdown başlığı mı? ("## Başlık" veya tamamı kalın "**Başlık**") → iddia değil. */
function isStructuralHeader(s: string): boolean {
  return /^#{1,6}\s/.test(s) || /^\*\*[^*]+\*\*:?$/.test(s);
}

/** Metindeki tüm [^N] numaralarını (tekrarlı) sırayla döndürür. */
export function extractCitationNumbers(text: string): number[] {
  const nums: number[] = [];
  for (const match of text.matchAll(CITATION_GLOBAL)) {
    nums.push(Number(match[1]));
  }
  return nums;
}

/**
 * Metni kaba "iddia cümlelerine" böler: . ! ? veya satır sonu.
 * Saf markdown gürültüsünü eler:
 *   - atıfları çıkardıktan sonra en az bir harf/rakam kalmalı
 *   - salt başlık satırları ("**Key Findings**", "## ...") iddia DEĞİL → çıkar
 *     (yoksa başlıklar "atıfsız cümle" sayılıp kapsamı yanlış düşürür).
 */
function splitIntoClaimSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => /[\p{L}\p{N}]/u.test(s.replace(CITATION_GLOBAL, "")))
    .filter((s) => !isStructuralHeader(s));
}

/**
 * Cevabı, retrieve edilen chunk sayısına karşı doğrular.
 * @param text       LLM'in ürettiği tam cevap
 * @param chunkCount Bu cevap için context'e konan chunk sayısı (geçerli N üst sınırı)
 * @param options    mode: "synthesis" → daha düşük kapsam eşiği (yapısal bölümler atıfsız)
 */
export function validateCitations(
  text: string,
  chunkCount: number,
  options: { mode?: "documents" | "literature" | "synthesis" } = {}
): CitationValidation {
  const threshold =
    options.mode === "synthesis"
      ? COVERAGE_THRESHOLD_SYNTHESIS
      : COVERAGE_THRESHOLD_DEFAULT;

  const citedNumbers = [...new Set(extractCitationNumbers(text))].sort(
    (a, b) => a - b
  );
  const valid = citedNumbers.filter((n) => n >= 1 && n <= chunkCount);
  const invalid = citedNumbers.filter((n) => n < 1 || n > chunkCount);

  const sentences = splitIntoClaimSentences(text);
  const totalSentences = sentences.length;
  const citedSentences = sentences.filter((s) => HAS_CITATION.test(s)).length;
  const uncitedSentences = totalSentences - citedSentences;
  const coverage = totalSentences === 0 ? 0 : citedSentences / totalSentences;

  const ok =
    invalid.length === 0 && valid.length > 0 && coverage >= threshold;

  return {
    citedNumbers,
    valid,
    invalid,
    distinctChunksUsed: valid.length,
    totalSentences,
    uncitedSentences,
    coverage: Math.round(coverage * 100) / 100,
    ok,
  };
}
