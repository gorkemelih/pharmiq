-- PharmIQ — Postgres init extensions
-- Loaded automatically when the postgres container first starts.

-- pgvector for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Postgres FTS Turkish (built-in stemmer 'turkish')
-- Built-in dictionary, no extra setup needed.

-- pg_trgm for fuzzy text search on medical terms
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- uuid-ossp for legacy UUID functions (gen_random_uuid is built-in in pg13+)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Useful for citation chunk fingerprinting
CREATE EXTENSION IF NOT EXISTS pgcrypto;
