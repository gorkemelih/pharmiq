/**
 * PharmIQ — Drizzle Schema (Demo Sade Versiyonu)
 *
 * Plan §8.1 reference. Demo'da çoğu tabloyu basitleştirdik:
 * - Multi-tenant kaldı (RLS Hafta 4'te eklenebilir)
 * - audit_logs ve usage_records yok (demo gerek yok)
 * - SSO field'ları sade
 *
 * Embedding boyutu 1024 — Cohere embed-multilingual-v3 spec.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
  boolean,
  decimal,
  index,
  vector,
  customType,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// pgvector tipi 1024 boyutlu (Cohere multilingual v3)
const VECTOR_DIM = 1024;

// =============================================================================
// TENANT MANAGEMENT
// =============================================================================

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").notNull().default("trial"),
  region: text("region").notNull().default("eu"),
  settings: jsonb("settings").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    fullName: text("full_name"),
    role: text("role").notNull().default("member"),
    preferredLanguage: text("preferred_language").default("tr"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("users_tenant_email_idx").on(t.tenantId, t.email)]
);

// =============================================================================
// DOCUMENTS
// =============================================================================

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    title: text("title").notNull(),
    sourceType: text("source_type").notNull(),
    sourceUrl: text("source_url"),
    storagePath: text("storage_path").notNull(),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    mimeType: text("mime_type"),
    language: text("language"),
    documentType: text("document_type"),
    status: text("status").notNull().default("pending"),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    index("documents_tenant_idx").on(t.tenantId),
    index("documents_status_idx").on(t.status),
  ]
);

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),

    content: text("content").notNull(),
    contextualContent: text("contextual_content"),
    language: text("language").notNull(),

    pageNumber: integer("page_number"),
    paragraphIndex: integer("paragraph_index"),
    charOffsetStart: integer("char_offset_start"),
    charOffsetEnd: integer("char_offset_end"),
    sectionPath: text("section_path"),

    embedding: vector("embedding", { dimensions: VECTOR_DIM }),
    embeddingTranslated: vector("embedding_translated", {
      dimensions: VECTOR_DIM,
    }),

    medicalEntities: jsonb("medical_entities").default([]).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("chunks_tenant_doc_idx").on(t.tenantId, t.documentId),
    // pgvector cosine indexes are added in raw SQL migration
  ]
);

// =============================================================================
// CHAT
// =============================================================================

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),

    role: text("role").notNull(),
    content: text("content").notNull(),
    language: text("language"),

    modelUsed: text("model_used"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: decimal("cost_usd", { precision: 10, scale: 6 }),
    latencyMs: integer("latency_ms"),

    citations: jsonb("citations").default([]).notNull(),

    hasOffLabelClaim: boolean("has_off_label_claim").default(false).notNull(),
    mlrStatus: text("mlr_status").default("pre_mlr").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("messages_conv_idx").on(t.conversationId, t.createdAt)]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  documents: many(documents),
  conversations: many(conversations),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id],
  }),
  documents: many(documents),
  conversations: many(conversations),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [documents.tenantId],
    references: [tenants.id],
  }),
  uploader: one(users, {
    fields: [documents.uploadedBy],
    references: [users.id],
  }),
  chunks: many(chunks),
}));

export const chunksRelations = relations(chunks, ({ one }) => ({
  tenant: one(tenants, {
    fields: [chunks.tenantId],
    references: [tenants.id],
  }),
  document: one(documents, {
    fields: [chunks.documentId],
    references: [documents.id],
  }),
}));

export const conversationsRelations = relations(
  conversations,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [conversations.tenantId],
      references: [tenants.id],
    }),
    user: one(users, {
      fields: [conversations.userId],
      references: [users.id],
    }),
    messages: many(messages),
  })
);

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  tenant: one(tenants, {
    fields: [messages.tenantId],
    references: [tenants.id],
  }),
}));

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Chunk = typeof chunks.$inferSelect;
export type NewChunk = typeof chunks.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
