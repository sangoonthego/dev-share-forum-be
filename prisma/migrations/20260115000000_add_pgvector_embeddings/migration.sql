-- Enable pgvector extension if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Alter posts table to add embedding support (if not already present)
-- The embedding column is already defined in the schema as Unsupported("vector(768)")
-- This migration ensures the extension is enabled and creates the HNSW index

-- Create HNSW index for fast similarity search
-- HNSW (Hierarchical Navigable Small World) is optimal for vector search
-- m=16: Number of connections per node (default 16)
-- ef_construction=64: Size of dynamic list (higher = better quality, slower insertion)
CREATE INDEX IF NOT EXISTS idx_posts_embedding_hnsw 
ON "posts" USING hnsw ("embedding" vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Create additional indexes for common filters
CREATE INDEX IF NOT EXISTS idx_posts_deleted_at_status 
ON "posts" ("deleted_at", "status") 
WHERE "deleted_at" IS NULL;

-- Index for author_id + status combo searches
CREATE INDEX IF NOT EXISTS idx_posts_author_id_status 
ON "posts" ("author_id", "status");
