-- DropIndex
DROP INDEX "Kelas_schoolId_idx";

-- DropIndex
DROP INDEX "Mapel_schoolId_idx";

-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "lockedAt" TIMESTAMP(3);
