-- CreateEnum
CREATE TYPE "CronType" AS ENUM ('PROMPT', 'IMPORT');

-- AlterTable
ALTER TABLE "CronJob" ADD COLUMN     "type" "CronType" NOT NULL DEFAULT 'PROMPT',
ALTER COLUMN "prompt" DROP NOT NULL;
