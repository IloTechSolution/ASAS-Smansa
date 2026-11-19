-- AlterTable
ALTER TABLE "ExamSession" ADD COLUMN     "hariPelaksanaan" TEXT,
ADD COLUMN     "visibleToSiswa" BOOLEAN NOT NULL DEFAULT false;
