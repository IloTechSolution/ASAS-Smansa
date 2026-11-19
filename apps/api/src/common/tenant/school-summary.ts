import { SchoolSummary } from '@cbt/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Ringkasan sekolah untuk respons auth (login & /auth/me). */
export async function schoolSummary(prisma: PrismaService, schoolId: string): Promise<SchoolSummary | null> {
  const [school, ta] = await Promise.all([
    prisma.school.findUnique({ where: { id: schoolId } }),
    prisma.globalConfig.findUnique({ where: { schoolId_key: { schoolId, key: 'TAHUN_AJARAN' } } }),
  ]);
  if (!school) return null;
  return {
    id: school.id,
    slug: school.slug,
    name: school.name,
    appName: school.appName,
    tahunAjaran: ta?.value ?? null,
    headmasterName: school.headmasterName,
    headmasterNip: school.headmasterNip,
    hasLogo: Boolean(school.logoPath),
  };
}
