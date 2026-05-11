/**
 * PharmIQ — GET /api/documents
 *
 * Tüm dokümanları listeler (tek-tenant demo).
 * Library sayfası polling ile bu endpoint'i çağırır.
 */

import { NextResponse } from "next/server";
import { listDocuments, countChunksForDocument } from "@/lib/db/queries";

export const runtime = "nodejs";

export async function GET() {
  try {
    const docs = await listDocuments();

    // Her doc için chunk count ekle (UI'da "312 chunk" yazsın)
    const enriched = await Promise.all(
      docs.map(async (d) => {
        const chunkCount =
          d.status === "ready" ? await countChunksForDocument(d.id) : 0;
        return {
          id: d.id,
          title: d.title,
          status: d.status,
          language: d.language,
          documentType: d.documentType,
          fileSizeBytes: d.fileSizeBytes,
          createdAt: d.createdAt,
          processedAt: d.processedAt,
          chunkCount,
          metadata: d.metadata,
        };
      })
    );

    return NextResponse.json({ documents: enriched });
  } catch (err) {
    console.error("[GET /api/documents]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "List failed" },
      { status: 500 }
    );
  }
}
