/**
 * PharmIQ — openFDA Korpus Yükleyici
 *
 * recordati.pdf yerine GERÇEK ilaç etiketlerini korpusa yükler.
 * Kaynak: openFDA drug labeling API (api.fda.gov/drug/label.json) — CC0 public domain.
 *
 * Her etiketin bölümlerini (Indications, Dosage, Warnings, Adverse...) sectionPath'li
 * paragraflara çevirir → chunkDocument (içeriğe [bölüm] öneki ekler) → Ollama embed → DB.
 * LLM-contextualization YOK (bölüm adı zaten bağlam verir + kota yemez); embed lokal/ücretsiz.
 *
 * Kullanım: pnpm load:openfda
 */

import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "..", ".env.local") });

import {
  createDocument,
  updateDocumentStatus,
  insertChunks,
  listDocuments,
  deleteDocument,
} from "../lib/db/queries";
import { DEMO_USER_ID } from "../lib/db/constants";
import { chunkDocument } from "../lib/rag/chunking";
import { embedChunks } from "../lib/rag/embedding";
import type { ParsedDocument, ParsedParagraph } from "../lib/pdf/parser";
import type { NewChunk } from "../lib/db/schema";

const LIMIT = 15; // korpus boyutu (yeterli "distractor" için)
const MAX_SECTION_CHARS = 3000;

// openFDA label alanı → okunabilir bölüm adı
const SECTIONS: Array<[string, string]> = [
  ["indications_and_usage", "Indications and Usage"],
  ["dosage_and_administration", "Dosage and Administration"],
  ["contraindications", "Contraindications"],
  ["boxed_warning", "Boxed Warning"],
  ["warnings_and_cautions", "Warnings and Cautions"],
  ["warnings", "Warnings"],
  ["adverse_reactions", "Adverse Reactions"],
  ["drug_interactions", "Drug Interactions"],
];

interface FdaLabel {
  id?: string;
  openfda?: { brand_name?: string[]; generic_name?: string[] };
  [field: string]: unknown;
}

function labelToParsed(
  label: FdaLabel
): { title: string; parsed: ParsedDocument } | null {
  const title =
    label.openfda?.brand_name?.[0] ||
    label.openfda?.generic_name?.[0] ||
    (label.id ? `Drug ${label.id}` : "Unknown drug");

  const paragraphs: ParsedParagraph[] = [];
  let offset = 0;
  let idx = 0;

  for (const [field, sectionName] of SECTIONS) {
    const val = label[field];
    if (!val) continue;
    const raw = Array.isArray(val) ? val.join("\n") : String(val);
    const clean = raw.replace(/\s+/g, " ").trim().slice(0, MAX_SECTION_CHARS);
    if (clean.length < 40) continue;
    paragraphs.push({
      index: idx++,
      text: clean,
      charOffsetStart: offset,
      charOffsetEnd: offset + clean.length,
      sectionPath: sectionName,
    });
    offset += clean.length + 1;
  }

  if (paragraphs.length === 0) return null;
  const fullText = paragraphs.map((p) => p.text).join("\n\n");
  return {
    title,
    parsed: {
      pageCount: 1,
      pages: [{ pageNumber: 1, text: fullText, paragraphs }],
      fullText,
      detectedLanguage: "en",
    },
  };
}

async function main() {
  // 1. Mevcut (recordati) dokümanları temizle → temiz korpus
  const existing = await listDocuments();
  for (const d of existing) {
    await deleteDocument(d.id); // cascade → chunks da silinir
  }
  console.log(`Temizlendi: ${existing.length} eski doküman`);

  // 2. openFDA'dan etiketleri çek (CC0)
  // Reçeteli ilaçlar + indikasyonu olanlar → dolu, anlamlı etiketler (OTC/homeopatik değil)
  const search =
    'openfda.product_type:"HUMAN PRESCRIPTION DRUG" AND _exists_:indications_and_usage';
  const url = `https://api.fda.gov/drug/label.json?search=${encodeURIComponent(
    search
  )}&limit=${LIMIT}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`openFDA HTTP ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { results: FdaLabel[] };
  console.log(`openFDA: ${data.results.length} etiket çekildi`);

  // 3. Her etiket → parse → chunk → embed → DB
  let okDocs = 0;
  let totalChunks = 0;
  for (const label of data.results) {
    const built = labelToParsed(label);
    if (!built) continue;

    const doc = await createDocument({
      uploadedBy: DEMO_USER_ID,
      title: built.title,
      sourceType: "openfda",
      sourceUrl: `https://api.fda.gov/drug/label.json?search=id:${label.id}`,
      storagePath: `openfda:${label.id ?? built.title}`,
      mimeType: "application/json",
      language: "en",
      documentType: "drug-label",
      status: "processing",
    });

    const chunks = chunkDocument(built.parsed);
    const embedded = await embedChunks(chunks); // Ollama (ücretsiz)
    const rows: Omit<NewChunk, "tenantId" | "documentId">[] = embedded.map((c) => ({
      content: c.content, // chunkDocument zaten [bölüm] önekini ekledi
      language: c.language,
      pageNumber: c.pageNumber,
      paragraphIndex: c.paragraphIndex,
      charOffsetStart: c.charOffsetStart,
      charOffsetEnd: c.charOffsetEnd,
      sectionPath: c.sectionPath,
      embedding: c.embedding as unknown as number[],
    }));
    await insertChunks(doc.id, rows);
    await updateDocumentStatus(doc.id, "ready", {
      metadata: { source: "openFDA", chunkCount: rows.length },
    });

    okDocs++;
    totalChunks += rows.length;
    console.log(`✓ ${built.title.slice(0, 40)} — ${rows.length} chunk`);
  }

  console.log(`\nKorpus hazır: ${okDocs} doküman, ${totalChunks} chunk (openFDA, CC0).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
