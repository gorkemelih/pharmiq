/**
 * PharmIQ — Database Query Helpers
 *
 * Tek-tenant demo için ortak query'ler. Multi-tenant'a geçince tenantId filtresi
 * her query'ye otomatik eklenmeli (Drizzle RLS plugin veya prepared stmt).
 */

import { eq, desc, sql } from "drizzle-orm";
import { db } from "./client";
import { documents, chunks } from "./schema";
import type { NewDocument, NewChunk, Document } from "./schema";
import { DEMO_TENANT_ID } from "./constants";

export async function createDocument(
  data: Omit<NewDocument, "tenantId">
): Promise<Document> {
  const [doc] = await db
    .insert(documents)
    .values({ ...data, tenantId: DEMO_TENANT_ID })
    .returning();
  return doc;
}

export async function updateDocumentStatus(
  id: string,
  status: "pending" | "processing" | "ready" | "failed",
  patch: Partial<NewDocument> = {}
): Promise<void> {
  await db
    .update(documents)
    .set({
      status,
      ...patch,
      ...(status === "ready" ? { processedAt: new Date() } : {}),
    })
    .where(eq(documents.id, id));
}

export async function insertChunks(
  documentId: string,
  rows: Omit<NewChunk, "tenantId" | "documentId">[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const values = rows.map((r) => ({
    ...r,
    tenantId: DEMO_TENANT_ID,
    documentId,
  }));
  // Drizzle vector kolonlarını otomatik handle eder
  await db.insert(chunks).values(values);
  return rows.length;
}

export async function listDocuments(): Promise<Document[]> {
  return db
    .select()
    .from(documents)
    .where(eq(documents.tenantId, DEMO_TENANT_ID))
    .orderBy(desc(documents.createdAt));
}

export async function getDocument(id: string): Promise<Document | undefined> {
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  return doc;
}

export async function deleteDocument(id: string): Promise<void> {
  await db.delete(documents).where(eq(documents.id, id));
}

export async function countChunksForDocument(documentId: string): Promise<number> {
  const result = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*)::text AS count FROM chunks WHERE document_id = ${documentId}`
  );
  return Number(result[0]?.count ?? 0);
}
