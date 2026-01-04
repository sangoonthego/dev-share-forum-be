-- CreateEnum
CREATE TYPE "LoginStatus" AS ENUM ('SUCCESS', 'FAILED', 'BLOCKED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "profile_avatar" TEXT,
ADD COLUMN     "token_version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "login_audits" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "status" "LoginStatus" NOT NULL DEFAULT 'SUCCESS',
    "ip_address" TEXT,
    "user_agent" TEXT,
    "attempted_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "login_audits_user_id_idx" ON "login_audits"("user_id");

-- CreateIndex
CREATE INDEX "login_audits_created_at_idx" ON "login_audits"("created_at");

-- AddForeignKey
ALTER TABLE "login_audits" ADD CONSTRAINT "login_audits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
