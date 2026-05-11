/**
 * Chat message metadata (server'dan stream'le gelir).
 * /api/chat route'taki messageMetadata callback ile eşleşir.
 */

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
}
