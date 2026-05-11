/**
 * PharmIQ — POST /api/documents/upload
 *
 * Multipart PDF yükle → DB'ye kaydet → arka planda ingest (parse + chunk + embed).
 * Client'a hemen 202 döner, polling ile status takip eder.
 *
 * NOT: Demo'da promise'ı await etmeden bırakıyoruz (fire-and-forget).
 * Production'da BullMQ / pg-boss / Vercel Queue gerekir.
 */

import { NextResponse } from "next/server";
import { saveUpload } from "@/lib/storage/local";
import { createDocument } from "@/lib/db/queries";
import { ingestPdf } from "@/lib/rag/ingest";
import { DEMO_USER_ID } from "@/lib/db/constants";

export const runtime = "nodejs"; // pdfjs-dist Node API gerektiriyor
export const maxDuration = 60; // demo'da hızlı

const ALLOWED_MIME = ["application/pdf"];
const MAX_BYTES = 50 * 1024 * 1024; // 50MB

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No file in form data (field name must be 'file')" },
        { status: 400 }
      );
    }

    if (!ALLOWED_MIME.includes(file.type)) {
      return NextResponse.json(
        { error: `Only PDF allowed (got ${file.type})` },
        { status: 400 }
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (${(file.size / 1e6).toFixed(1)}MB > 50MB)` },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // 1. Disk'e kaydet
    const saved = await saveUpload(buffer, file.name);

    // 2. Documents tablosuna yaz (status=pending)
    const doc = await createDocument({
      uploadedBy: DEMO_USER_ID,
      title: file.name.replace(/\.pdf$/i, ""),
      sourceType: "upload",
      storagePath: saved.path,
      fileSizeBytes: file.size,
      mimeType: file.type,
      documentType: "smpc", // demo'da default; UI'dan seçilebilir Hafta 4
      status: "pending",
    });

    // 3. Fire-and-forget ingest (arka planda)
    queueMicrotask(() => {
      ingestPdf(doc.id, buffer).catch((err) => {
        console.error("[upload] background ingest failed", doc.id, err);
      });
    });

    return NextResponse.json(
      {
        id: doc.id,
        title: doc.title,
        status: doc.status,
        fileSizeBytes: doc.fileSizeBytes,
      },
      { status: 202 }
    );
  } catch (err) {
    console.error("[POST /api/documents/upload]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}
