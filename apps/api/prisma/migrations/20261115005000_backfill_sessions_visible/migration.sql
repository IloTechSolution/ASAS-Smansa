-- Backfill: sesi terjadwal/aktif/ditutup dianggap tampil ke siswa.
UPDATE "ExamSession" SET "visibleToSiswa" = TRUE WHERE status IN ('ACTIVE', 'SCHEDULED', 'CLOSED');
