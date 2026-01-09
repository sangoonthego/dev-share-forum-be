-- Add soft delete support to comments table
ALTER TABLE "comments" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- Create index on deleted_at for efficient filtering
CREATE INDEX "comments_deleted_at_idx" ON "comments"("deleted_at");
