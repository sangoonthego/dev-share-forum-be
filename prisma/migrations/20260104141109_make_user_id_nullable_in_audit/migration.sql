-- DropForeignKey
ALTER TABLE "login_audits" DROP CONSTRAINT "login_audits_user_id_fkey";

-- AlterTable
ALTER TABLE "login_audits" ALTER COLUMN "user_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "login_audits" ADD CONSTRAINT "login_audits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
