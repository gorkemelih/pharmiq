# PharmIQ — Pharma Vertical RAG Demo

> **Profesyonel İlaç Sektörü için Çoklu Dilli, MLR-Uyumlu, Kaynak-Gösterimli AI Yardımcısı**

Bu repo, [docs/PharmIQ_Proje_Plani.md](docs/PharmIQ_Proje_Plani.md) dokümanında tarif edilen ürünün **localhost demo** versiyonudur. Pilot SOW görüşmelerinde kullanılmak üzere tasarlanmıştır.

## Mimarisi

- **Frontend + BFF:** Next.js 15 App Router (TypeScript)
- **Veritabanı:** PostgreSQL 15 + pgvector (yerel Supabase Docker)
- **ORM:** Drizzle
- **LLM Rotation:** Gemini 3 Flash → Claude Sonnet 4.6 → Mistral Large 3 → Groq Llama 4
- **Embedding:** Cohere Embed v3 multilingual (GitHub Models) → BGE-M3 fallback
- **Reranker:** BGE-Reranker-v2-m3 (lokal CPU)
- **PDF:** pdfjs-dist
- **Streaming:** Vercel AI SDK 6
- **i18n:** next-intl (TR + EN)
- **UI:** shadcn/ui + Tailwind

## İlk Kurulum

```bash
# 1. Bağımlılıkları kur
pnpm install

# 2. Veritabanı (Docker)
pnpm db:up
pnpm db:migrate

# 3. .env.local oluştur (.env.example'ı kopyala, API key'leri doldur)
cp .env.example .env.local

# 4. Demo dokümanlarını seed et
pnpm seed

# 5. Başlat
pnpm dev
```

Tarayıcı: `http://localhost:3000`

## Klasör Yapısı

Detaylar için [docs/](docs/) klasörüne bakın.

```
pharmiq/
├── apps/web/                Next.js 15 monolith
├── data/                    Demo PDF'leri ve golden queries
├── infrastructure/          Supabase Docker compose
└── docs/                    Plan ve referans dokümanları
```

## Demo Senaryoları

`data/golden-queries.json` dosyasında 7 hazır demo sorgusu var. Demo akışı için: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) (Hafta 6'da yazılacak).

## Lisans

Proprietary — All rights reserved.
