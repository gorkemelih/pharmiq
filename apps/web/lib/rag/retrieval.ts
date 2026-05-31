/**
 * PharmIQ — Hybrid Retrieval
 *
 * Plan §5.3 Step 2: pgvector cosine + Postgres FTS (turkish) → RRF fusion.
 * BGE-Reranker Hafta 4'te eklenecek; demo için ilk top-K yeterli.
 *
 * Sonuç: her chunk için score + retrieval source (vector/keyword/both).
 */

import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { DEMO_TENANT_ID } from "../db/constants";
import { embedQuery } from "./embedding";

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  language: string;
  pageNumber: number | null;
  paragraphIndex: number | null;
  sectionPath: string | null;
  /** RRF normalized score (0..1) */
  score: number;
  /** Hangi yöntem(ler) bu chunk'ı buldu */
  sources: Array<"vector" | "keyword">;
  /** Vector benzerlik (1 - cosine distance) — yoksa undefined */
  vectorSimilarity?: number;
  /** FTS rank (ts_rank_cd) — yoksa undefined */
  ftsRank?: number;
}

export interface RetrieveOptions {
  /** Sonuç chunk sayısı (default 10) */
  topK?: number;
  /** Her yöntemden alınacak ham aday sayısı (default 25) */
  candidatePoolPerMethod?: number;
  /** Belirli dokümanlara kısıtla (UI'da "şu dosyada ara" seçeneği) */
  documentIds?: string[];
  /** RRF k constant — 60 standart (Cormack et al.) */
  rrfK?: number;
}

interface RawRow extends Record<string, unknown> {
  chunk_id: string;
  document_id: string;
  document_title: string;
  content: string;
  language: string;
  page_number: number | null;
  paragraph_index: number | null;
  section_path: string | null;
  similarity?: number; // vector
  fts_rank?: number; // keyword
}

const DEFAULTS = {
  topK: 10,
  candidatePoolPerMethod: 25,
  rrfK: 60,
};

/**
 * Hybrid retrieval orchestrator.
 *
 * 1. Query'yi embed et (Gemini)
 * 2. Paralel olarak vector + FTS sorgula
 * 3. RRF (Reciprocal Rank Fusion) ile birleştir
 * 4. Top-K döndür
 */
export async function retrieve(
  query: string,
  options: RetrieveOptions = {}
): Promise<RetrievedChunk[]> {
  const opts = { ...DEFAULTS, ...options };

  // 1. Query embedding
  const queryVector = await embedQuery(query);

  // 2. Paralel arama
  const [vectorRows, keywordRows] = await Promise.all([
    vectorSearch(queryVector, opts),
    keywordSearch(query, opts),
  ]);

  // 3. RRF fusion
  const fused = rrfFusion(vectorRows, keywordRows, opts.rrfK);

  // 4. Top-K
  return fused.slice(0, opts.topK);
}

async function vectorSearch(
  embedding: number[],
  opts: { candidatePoolPerMethod: number; documentIds?: string[] }
): Promise<RawRow[]> {
  // pgvector cosine distance: 0 (identical) → 2 (opposite)
  // Similarity'ye çevir: 1 - distance (yüksek = daha benzer)
  const vectorLiteral = `[${embedding.join(",")}]`;
  // NOT: ANY(${array}) drizzle+postgres'te bozuk array literal üretiyordu (22P02).
  // Her id'yi ayrı param yapıp ARRAY[...]::uuid[] olarak bind ediyoruz.
  const docFilter = opts.documentIds?.length
    ? sql`AND c.document_id = ANY(ARRAY[${sql.join(
        opts.documentIds.map((id) => sql`${id}`),
        sql`, `
      )}]::uuid[])`
    : sql``;

  const result = await db.execute<RawRow>(sql`
    SELECT
      c.id AS chunk_id,
      c.document_id,
      d.title AS document_title,
      c.content,
      c.language,
      c.page_number,
      c.paragraph_index,
      c.section_path,
      1 - (c.embedding <=> ${vectorLiteral}::vector) AS similarity
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE c.tenant_id = ${DEMO_TENANT_ID}
      AND c.embedding IS NOT NULL
      ${docFilter}
    ORDER BY c.embedding <=> ${vectorLiteral}::vector
    LIMIT ${opts.candidatePoolPerMethod}
  `);

  return Array.from(result);
}

async function keywordSearch(
  query: string,
  opts: { candidatePoolPerMethod: number; documentIds?: string[] }
): Promise<RawRow[]> {
  // Postgres FTS: turkish dictionary (snowball stemmer)
  // ts_rank_cd: cover density ranking (kelime yakınlığına önem verir)
  // plainto_tsquery: doğal dil query'yi tsquery'ye çevirir, AND'le
  // NOT: ANY(${array}) drizzle+postgres'te bozuk array literal üretiyordu (22P02).
  // Her id'yi ayrı param yapıp ARRAY[...]::uuid[] olarak bind ediyoruz.
  const docFilter = opts.documentIds?.length
    ? sql`AND c.document_id = ANY(ARRAY[${sql.join(
        opts.documentIds.map((id) => sql`${id}`),
        sql`, `
      )}]::uuid[])`
    : sql``;

  const result = await db.execute<RawRow>(sql`
    SELECT
      c.id AS chunk_id,
      c.document_id,
      d.title AS document_title,
      c.content,
      c.language,
      c.page_number,
      c.paragraph_index,
      c.section_path,
      ts_rank_cd(
        to_tsvector('turkish', c.content),
        plainto_tsquery('turkish', ${query})
      ) AS fts_rank
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE c.tenant_id = ${DEMO_TENANT_ID}
      AND to_tsvector('turkish', c.content) @@ plainto_tsquery('turkish', ${query})
      ${docFilter}
    ORDER BY fts_rank DESC
    LIMIT ${opts.candidatePoolPerMethod}
  `);

  return Array.from(result);
}

/**
 * Reciprocal Rank Fusion: rank(i) = sum over methods of 1 / (k + rank_i_in_method).
 * k=60 standart literatürde (Cormack 2009).
 */
function rrfFusion(
  vectorRows: RawRow[],
  keywordRows: RawRow[],
  k: number
): RetrievedChunk[] {
  const scores = new Map<
    string,
    {
      row: RawRow;
      score: number;
      sources: Set<"vector" | "keyword">;
      vectorSimilarity?: number;
      ftsRank?: number;
    }
  >();

  vectorRows.forEach((row, idx) => {
    const rrfScore = 1 / (k + idx + 1);
    scores.set(row.chunk_id, {
      row,
      score: rrfScore,
      sources: new Set(["vector"]),
      vectorSimilarity: row.similarity,
    });
  });

  keywordRows.forEach((row, idx) => {
    const rrfScore = 1 / (k + idx + 1);
    const existing = scores.get(row.chunk_id);
    if (existing) {
      existing.score += rrfScore;
      existing.sources.add("keyword");
      existing.ftsRank = row.fts_rank;
    } else {
      scores.set(row.chunk_id, {
        row,
        score: rrfScore,
        sources: new Set(["keyword"]),
        ftsRank: row.fts_rank,
      });
    }
  });

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .map(({ row, score, sources, vectorSimilarity, ftsRank }) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      documentTitle: row.document_title,
      content: row.content,
      language: row.language,
      pageNumber: row.page_number,
      paragraphIndex: row.paragraph_index,
      sectionPath: row.section_path,
      score,
      sources: [...sources],
      vectorSimilarity,
      ftsRank,
    }));
}
