/**
 * PharmIQ — Literatür arama tipleri (Faz 1: dış kaynak literatür)
 *
 * Plan §1.4: "PubMed/ClinicalTrials/EMA gibi kaynaklarda otomatik arama".
 * Bir literatür sonucu = atıflanabilir bir makale (PMID/DOI provenance'lı).
 */

export interface PaperCandidate {
  /** Kararlı tekil id (doi > pmid > kaynak-id sırasıyla) */
  id: string;
  /** Europe PMC kaynağı: MED=PubMed/MEDLINE, PMC, PPR=preprint, AGR, CBA... */
  source: string;
  title: string;
  abstract: string;
  /** "Smith J, Doe A, ..." */
  authors: string;
  journal: string;
  year: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  /** Kanonik link (DOI varsa doi.org, yoksa PubMed/Europe PMC) */
  url: string;
  citationCount?: number;
}

export interface LiteratureSearchOptions {
  /** Sağlayıcı başına maksimum sonuç (varsayılan 20) */
  limit?: number;
  /** Sadece PubMed/MEDLINE kayıtları (Europe PMC'de SRC:MED filtresi) */
  pubmedOnly?: boolean;
}
