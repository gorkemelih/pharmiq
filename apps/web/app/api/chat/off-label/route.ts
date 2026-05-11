/**
 * PharmIQ — POST /api/chat/off-label
 *
 * Client streaming bittiğinde bu endpoint'i çağırır.
 * Body: { question, answer, chunkIds? } veya { question, answer, citations }
 *
 * Server: chunks'ı (ya client'tan ya retrieval yaparak) toplar, judge'u çalıştırır.
 * Response: OffLabelDetection
 *
 * Demo'da basit yol: client gerekli minimum bilgiyi yollasın
 * (citations'tan chunkId'leri çıkarıp DB'den getiriyoruz).
 */

import { NextResponse } from "next/server";
import { detectOffLabel } from "@/lib/mlr/off-label";
import { db } from "@/lib/db/client";
import { chunks, documents } from "@/lib/db/schema";
import { inArray, eq } from "drizzle-orm";
import { DEMO_TENANT_ID } from "@/lib/db/constants";
import { detectQueryLanguage } from "@/lib/llm/prompts";

export const runtime = "nodejs";

interface RequestBody {
  question: string;
  answer: string;
  chunkIds?: string[];
}

export async function POST(req: Request) {
  try {
    const { question, answer, chunkIds = [] } = (await req.json()) as RequestBody;

    if (!question || !answer) {
      return NextResponse.json(
        { error: "question and answer required" },
        { status: 400 }
      );
    }

    // Chunks'ı çek (sınırlı: judge zaten 8 chunk kullanıyor)
    const rows =
      chunkIds.length > 0
        ? await db
            .select({
              content: chunks.content,
              sectionPath: chunks.sectionPath,
              documentTitle: documents.title,
            })
            .from(chunks)
            .innerJoin(documents, eq(documents.id, chunks.documentId))
            .where(inArray(chunks.id, chunkIds.slice(0, 12)))
        : [];

    const language = detectQueryLanguage(answer);
    const detection = await detectOffLabel({
      question,
      answer,
      chunks: rows,
      language,
    });

    return NextResponse.json(detection);
  } catch (err) {
    console.error("[POST /api/chat/off-label]", err);
    return NextResponse.json(
      {
        detected: false,
        confidence: 0,
        reason: "Server error",
        suspectQuote: null,
      },
      { status: 500 }
    );
  }
}
