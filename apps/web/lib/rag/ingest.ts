/**
 * PharmIQ — Document Ingestion Orchestrator
 *
 * Tek bir fonksiyon: PDF buffer → DB'ye chunk + embedding.
 * Upload API route bunu çağırır.
 *
 * Akış (plan §5.3 Step 1-4):
 *   parse → chunk → embed → DB insert
 */

import { parsePdf } from "../pdf/parser";
import { chunkDocument } from "./chunking";
import { embedChunks } from "./embedding";
import { contextualizeChunks, buildEmbedText } from "./contextual";
import { insertChunks, updateDocumentStatus } from "../db/queries";
import type { NewChunk } from "../db/schema";

export interface IngestResult {
  documentId: string;
  pageCount: number;
  chunkCount: number;
  language: string;
  durationMs: number;
}

export async function ingestPdf(
  documentId: string,
  buffer: Buffer
): Promise<IngestResult> {
  const start = Date.now();

  try {
    await updateDocumentStatus(documentId, "processing");

    // 1. Parse
    const parsed = await parsePdf(buffer);
    console.log(
      `[ingest:${documentId}] Parsed ${parsed.pageCount} pages, lang=${parsed.detectedLanguage}`
    );

    // 2. Chunk
    const chunks = chunkDocument(parsed);
    console.log(`[ingest:${documentId}] Chunked into ${chunks.length} pieces`);

    if (chunks.length === 0) {
      throw new Error("No chunks produced — PDF may be empty or image-only");
    }

    // 2.5 Contextualize — her chunk'a kısa bağlam ekle (embedding'i keskinleştirir)
    const contextualized = await contextualizeChunks(parsed, chunks);
    const withCtx = contextualized.filter((c) => c.contextHeader).length;
    console.log(
      `[ingest:${documentId}] Contextualized ${withCtx}/${chunks.length} chunks`
    );

    // 3. Embed — bağlam + içeriği göm, ama içeriği VERBATIM sakla (faithful citation)
    const embedInput = contextualized.map((c) => ({
      ...c.chunk,
      content: buildEmbedText(c),
    }));
    const embedded = await embedChunks(embedInput, {
      onProgress: (done, total) => {
        if (done % 64 === 0 || done === total) {
          console.log(`[ingest:${documentId}] Embedded ${done}/${total}`);
        }
      },
    });

    // 4. DB insert — content = ORİJİNAL verbatim; embedding = contextualized metinden
    const rows: Omit<NewChunk, "tenantId" | "documentId">[] = embedded.map(
      (c, i) => ({
        content: chunks[i].content,
        language: c.language,
        pageNumber: c.pageNumber,
        paragraphIndex: c.paragraphIndex,
        charOffsetStart: c.charOffsetStart,
        charOffsetEnd: c.charOffsetEnd,
        sectionPath: c.sectionPath,
        // Drizzle vector kolonu için array — postgres-js otomatik bind eder
        embedding: c.embedding as any,
      })
    );
    await insertChunks(documentId, rows);

    await updateDocumentStatus(documentId, "ready", {
      language: parsed.detectedLanguage,
      metadata: {
        pageCount: parsed.pageCount,
        chunkCount: chunks.length,
        ingestedAt: new Date().toISOString(),
      },
    });

    const durationMs = Date.now() - start;
    console.log(
      `[ingest:${documentId}] ✓ Done in ${durationMs}ms (${chunks.length} chunks)`
    );

    return {
      documentId,
      pageCount: parsed.pageCount,
      chunkCount: chunks.length,
      language: parsed.detectedLanguage ?? "tr",
      durationMs,
    };
  } catch (err) {
    console.error(`[ingest:${documentId}] ✗ Failed`, err);
    await updateDocumentStatus(documentId, "failed", {
      metadata: {
        error: err instanceof Error ? err.message : String(err),
        failedAt: new Date().toISOString(),
      },
    });
    throw err;
  }
}
