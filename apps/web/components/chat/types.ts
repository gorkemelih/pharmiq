/**
 * Chat message metadata (server'dan stream'le gelir).
 * /api/chat route'taki messageMetadata callback ile eşleşir.
 */

import type { CitationValidation } from "@/lib/llm/citations";

export interface Citation {
  n: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  pageNumber: number | null;
  sectionPath: string | null;
  score: number;
  contentPreview: string;
}

export interface MessageMetadata {
  provider?: string;
  retrievedChunkCount?: number;
  citations?: Citation[];
  language?: "tr" | "en";
  /** Cevaptaki [^N] atıflarının doğrulama sonucu (server üretir). */
  citationValidation?: CitationValidation;
  /** Retrieval 0 chunk döndürdüyse: model çağrılmadı, sabit "kaynak yok" yanıtı. */
  noSources?: boolean;
}
