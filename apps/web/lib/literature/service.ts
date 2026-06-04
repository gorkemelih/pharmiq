/**
 * PharmIQ — Literatür arama servisi (Faz 1: dış kaynak)
 *
 * Sağlayıcıları sorgular + tekilleştirir (DOI → PMID → normalize başlık).
 * Şimdilik tek sağlayıcı (Europe PMC, PubMed/MEDLINE dahil). PubMed-direkt (efetch XML)
 * veya ClinicalTrials.gov sonradan aynı arayüzle eklenebilir.
 *
 * NOT: PubMed/MEDLINE'a kısıtlamak için pubmedOnly → Europe PMC'de "SRC:MED" filtresi.
 */

import type { PaperCandidate, LiteratureSearchOptions } from "./types";
import { searchEuropePMC } from "./europepmc";

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** DOI → PMID → normalize başlık ile tekilleştir; daha uzun abstract'lı olanı tut. */
function dedupe(papers: PaperCandidate[]): PaperCandidate[] {
  const byKey = new Map<string, PaperCandidate>();
  for (const p of papers) {
    const key = p.doi || p.pmid || normalizeTitle(p.title);
    const existing = byKey.get(key);
    if (!existing || p.abstract.length > existing.abstract.length) {
      byKey.set(key, p);
    }
  }
  return [...byKey.values()];
}

/**
 * Verilen sorgu için canlı literatür getirir (abstract'lı, atıflanabilir).
 * Hata olursa boş döner (akış kırılmaz) — çağıran tarafta "kaynak yok" ele alınır.
 */
export async function searchLiterature(
  query: string,
  opts: LiteratureSearchOptions = {}
): Promise<PaperCandidate[]> {
  const limit = opts.limit ?? 20;
  const q = opts.pubmedOnly ? `${query} AND SRC:MED` : query;

  try {
    const papers = await searchEuropePMC(q, limit);
    return dedupe(papers).slice(0, limit);
  } catch (err) {
    console.error(
      "[literature] arama başarısız:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}
