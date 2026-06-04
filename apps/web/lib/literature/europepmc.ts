/**
 * PharmIQ — Europe PMC literatür sağlayıcısı
 *
 * Europe PMC, PubMed/MEDLINE (SRC:MED) + PMC + preprint kayıtlarını TEK JSON API'de
 * abstract dahil döndürür → PubMed efetch XML parse derdi YOK. (Ref: PharmaInsightAI'da
 * PubMed+EuropePMC ayrı vardı; biz MVP'de Europe PMC'yi birincil alıyoruz, abstract'lı.)
 *
 * API: https://europepmc.org/RestfulWebService  (anahtar gerekmez)
 */

import type { PaperCandidate } from "./types";

const SEARCH_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

interface EpmcResult {
  id?: string;
  source?: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  title?: string;
  abstractText?: string;
  authorString?: string;
  journalTitle?: string;
  pubYear?: string;
  citedByCount?: number;
}

function strip(html: string | undefined): string {
  return (html ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function mapResult(r: EpmcResult): PaperCandidate | null {
  const title = strip(r.title);
  const abstract = strip(r.abstractText);
  // Abstract'ı olmayan kayıtlar RAG için işe yaramaz → ele
  if (!title || abstract.length < 40) return null;

  const url = r.doi
    ? `https://doi.org/${r.doi}`
    : r.pmid
      ? `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`
      : `https://europepmc.org/article/${r.source ?? "MED"}/${r.id ?? ""}`;

  return {
    id: r.doi || r.pmid || `${r.source ?? "MED"}:${r.id ?? title.slice(0, 24)}`,
    source: r.source ?? "MED",
    title,
    abstract,
    authors: strip(r.authorString),
    journal: strip(r.journalTitle),
    year: r.pubYear ?? "",
    pmid: r.pmid,
    pmcid: r.pmcid,
    doi: r.doi,
    url,
    citationCount: r.citedByCount,
  };
}

/** Europe PMC'de tam-metin sorgu; abstract'lı, atıflanabilir makaleler döndürür. */
export async function searchEuropePMC(
  query: string,
  limit = 20
): Promise<PaperCandidate[]> {
  const params = new URLSearchParams({
    query,
    format: "json",
    pageSize: String(Math.min(Math.max(limit, 1), 100)),
    resultType: "core", // tam metadata + abstract
  });

  const res = await fetch(`${SEARCH_URL}?${params.toString()}`, {
    signal: AbortSignal.timeout(15000),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`[EuropePMC] HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const data = (await res.json()) as { resultList?: { result?: EpmcResult[] } };
  const results = data.resultList?.result ?? [];
  return results.map(mapResult).filter((p): p is PaperCandidate => p !== null);
}
