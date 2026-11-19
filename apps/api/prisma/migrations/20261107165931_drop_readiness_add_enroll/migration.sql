/*
  Warnings:

  - You are about to drop the `ReadinessCheck` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ReadinessCheck" DROP CONSTRAINT "ReadinessCheck_sessionId_fkey";

-- DropTable
DROP TABLE "ReadinessCheck";

-- CreateTable
CREATE TABLE "ExamEnrollment" (
    "examId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamEnrollment_pkey" PRIMARY KEY ("examId","userId")
);

-- CreateIndex
CREATE INDEX "ExamEnrollment_userId_idx" ON "ExamEnrollment"("userId");

-- AddForeignKey
ALTER TABLE "ExamEnrollment" ADD CONSTRAINT "ExamEnrollment_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamEnrollment" ADD CONSTRAINT "ExamEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
