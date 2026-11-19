-- Multi-sekolah: SMAN 1 (data lama) & SMAN 8 (baru).
-- Backfill: semua data eksisting menjadi milik SMAN 1.

-- 1) Tabel School
CREATE TABLE "School" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "appName" TEXT NOT NULL,
  "headmasterName" TEXT,
  "headmasterNip" TEXT,
  "logoPath" TEXT,
  "ttdPath" TEXT,
  "stampPath" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "School_slug_key" ON "School"("slug");

INSERT INTO "School" ("id", "slug", "name", "appName", "headmasterName", "headmasterNip", "logoPath", "isActive", "createdAt", "updatedAt") VALUES
  ('sman1', 'sman1', 'SMAN 1 Gorontalo', 'CBT SMAN 1 Gorontalo', 'Dra. Adianiwaty S. Polapa, M.Pd', '196810131994122006', 'branding/sman1/logo.jpeg', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('sman8', 'sman8', 'SMAN 8 Gorontalo', 'CBT SMAN 8 Gorontalo', NULL, NULL, NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- 2) Kolom schoolId di semua tabel tenant (backfill SMAN 1)
ALTER TABLE "User" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "Kelas" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "Kelas" ADD COLUMN "ruang" TEXT;
ALTER TABLE "Mapel" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "Question" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "Exam" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "ExamEnrollment" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "ExamQuestion" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "ExamSession" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "Attempt" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "AttemptAnswer" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "IntegrityLog" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "TokenAudit" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "Attendance" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "GlobalConfig" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "schoolId" TEXT;

UPDATE "User" SET "schoolId" = 'sman1';
UPDATE "Kelas" SET "schoolId" = 'sman1';
UPDATE "Mapel" SET "schoolId" = 'sman1';
UPDATE "Question" SET "schoolId" = 'sman1';
UPDATE "Exam" SET "schoolId" = 'sman1';
UPDATE "ExamEnrollment" SET "schoolId" = 'sman1';
UPDATE "ExamQuestion" SET "schoolId" = 'sman1';
UPDATE "ExamSession" SET "schoolId" = 'sman1';
UPDATE "Attempt" SET "schoolId" = 'sman1';
UPDATE "AttemptAnswer" SET "schoolId" = 'sman1';
UPDATE "IntegrityLog" SET "schoolId" = 'sman1';
UPDATE "TokenAudit" SET "schoolId" = 'sman1';
UPDATE "Attendance" SET "schoolId" = 'sman1';
UPDATE "GlobalConfig" SET "schoolId" = 'sman1';

-- 3) GlobalConfig: PK lama (key) dilepas dulu, lalu salin konfigurasi ke SMAN 8
ALTER TABLE "GlobalConfig" DROP CONSTRAINT "GlobalConfig_pkey";
INSERT INTO "GlobalConfig" ("schoolId", "key", "value", "updatedAt")
SELECT 'sman8', "key", "value", CURRENT_TIMESTAMP FROM "GlobalConfig" WHERE "schoolId" = 'sman1';

ALTER TABLE "GlobalConfig" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "GlobalConfig" ADD CONSTRAINT "GlobalConfig_pkey" PRIMARY KEY ("schoolId", "key");

-- 4) NOT NULL + FK + index
ALTER TABLE "User" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "Kelas" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "Mapel" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "Question" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "Exam" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "ExamEnrollment" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "ExamQuestion" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "ExamSession" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "Attempt" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "AttemptAnswer" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "IntegrityLog" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "TokenAudit" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "Attendance" ALTER COLUMN "schoolId" SET NOT NULL;

ALTER TABLE "User" ADD CONSTRAINT "User_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Kelas" ADD CONSTRAINT "Kelas_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Mapel" ADD CONSTRAINT "Mapel_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Question" ADD CONSTRAINT "Question_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExamEnrollment" ADD CONSTRAINT "ExamEnrollment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExamQuestion" ADD CONSTRAINT "ExamQuestion_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExamSession" ADD CONSTRAINT "ExamSession_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttemptAnswer" ADD CONSTRAINT "AttemptAnswer_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IntegrityLog" ADD CONSTRAINT "IntegrityLog_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TokenAudit" ADD CONSTRAINT "TokenAudit_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GlobalConfig" ADD CONSTRAINT "GlobalConfig_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "User_schoolId_idx" ON "User"("schoolId");
CREATE INDEX "Kelas_schoolId_idx" ON "Kelas"("schoolId");
CREATE INDEX "Mapel_schoolId_idx" ON "Mapel"("schoolId");
CREATE INDEX "Question_schoolId_idx" ON "Question"("schoolId");
CREATE INDEX "Exam_schoolId_idx" ON "Exam"("schoolId");
CREATE INDEX "ExamEnrollment_schoolId_idx" ON "ExamEnrollment"("schoolId");
CREATE INDEX "ExamQuestion_schoolId_idx" ON "ExamQuestion"("schoolId");
CREATE INDEX "ExamSession_schoolId_idx" ON "ExamSession"("schoolId");
CREATE INDEX "Attempt_schoolId_idx" ON "Attempt"("schoolId");
CREATE INDEX "AttemptAnswer_schoolId_idx" ON "AttemptAnswer"("schoolId");
CREATE INDEX "IntegrityLog_schoolId_idx" ON "IntegrityLog"("schoolId");
CREATE INDEX "TokenAudit_schoolId_idx" ON "TokenAudit"("schoolId");
CREATE INDEX "Attendance_schoolId_idx" ON "Attendance"("schoolId");
CREATE INDEX "AuditLog_schoolId_idx" ON "AuditLog"("schoolId");

-- 5) Unik per sekolah (ganti yang global)
DROP INDEX IF EXISTS "Kelas_name_key";
CREATE UNIQUE INDEX "Kelas_schoolId_name_key" ON "Kelas"("schoolId", "name");
DROP INDEX IF EXISTS "Mapel_name_key";
DROP INDEX IF EXISTS "Mapel_code_key";
CREATE UNIQUE INDEX "Mapel_schoolId_name_key" ON "Mapel"("schoolId", "name");
CREATE UNIQUE INDEX "Mapel_schoolId_code_key" ON "Mapel"("schoolId", "code");
