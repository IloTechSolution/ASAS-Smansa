import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import type { ReactElement } from 'react';
import { AppShell } from './components/AppShell';
import { Spinner } from './components/ui';
import { useAuth } from './auth/AuthContext';
import { Login } from './pages/Login';
import { NotFound } from './pages/NotFound';

// Code-splitting per rute — chunk hanya dimuat saat halaman dibuka,
// sehingga bundle awal tetap kecil (terutama ExamRoom yang berat).
const Akun = lazy(() => import('./pages/Akun').then((m) => ({ default: m.Akun })));
const SiswaUjian = lazy(() => import('./pages/siswa/SiswaUjian').then((m) => ({ default: m.SiswaUjian })));
const ExamRoom = lazy(() => import('./pages/siswa/ExamRoom'));
const ProktorSesi = lazy(() => import('./pages/proktor/ProktorSesi'));
const MonitoringPanel = lazy(() => import('./pages/proktor/MonitoringPanel'));
const AdminAuditLog = lazy(() => import('./pages/admin/AuditLog').then((m) => ({ default: m.AdminAuditLog })));
const AdminHome = lazy(() => import('./pages/admin/AdminHome').then((m) => ({ default: m.AdminHome })));
const AdminSiswa = lazy(() => import('./pages/admin/Siswa').then((m) => ({ default: m.AdminSiswa })));
const AdminMapel = lazy(() => import('./pages/admin/Mapel').then((m) => ({ default: m.AdminMapel })));
const AdminKelas = lazy(() => import('./pages/admin/Kelas').then((m) => ({ default: m.AdminKelas })));
const AdminSettings = lazy(() => import('./pages/admin/Settings').then((m) => ({ default: m.AdminSettings })));
const AdminUsers = lazy(() => import('./pages/admin/Users').then((m) => ({ default: m.AdminUsers })));
const TokenPanel = lazy(() => import('./pages/proktor/TokenPanel'));
const AttendancePanel = lazy(() => import('./pages/proktor/AttendancePanel'));
const ProktorLayout = lazy(() => import('./pages/proktor/ProktorLayout'));
const PelanggaranPanel = lazy(() => import('./pages/proktor/PelanggaranPanel'));
const PresencePanel = lazy(() => import('./pages/proktor/PresencePanel'));
const SessionPengaturanWrapper = lazy(() => import('./pages/proktor/SesiPanels').then((m) => ({ default: m.SessionPengaturanWrapper })));
const EnrolSiswa = lazy(() => import('./pages/proktor/EnrolSiswa').then((m) => ({ default: m.EnrolSiswa })));
const KartuPeserta = lazy(() => import('./pages/proktor/KartuPeserta'));
const IntegrityPanel = lazy(() => import('./pages/proktor/IntegrityPanel'));
const GuruHome = lazy(() => import('./pages/guru/GuruHome').then((m) => ({ default: m.GuruHome })));
const QuestionBank = lazy(() => import('./pages/guru/QuestionBank').then((m) => ({ default: m.QuestionBank })));
const QuestionForm = lazy(() => import('./pages/guru/QuestionForm').then((m) => ({ default: m.QuestionForm })));
const ExamBuilder = lazy(() => import('./pages/guru/exams/ExamBuilder').then((m) => ({ default: m.ExamBuilder })));
const ExamList = lazy(() => import('./pages/guru/exams/ExamList').then((m) => ({ default: m.ExamList })));
const ExamPreview = lazy(() => import('./pages/guru/exams/ExamPreview').then((m) => ({ default: m.ExamPreview })));
const SessionForm = lazy(() => import('./pages/guru/sessions/SessionForm').then((m) => ({ default: m.SessionForm })));
const SessionList = lazy(() => import('./pages/guru/sessions/SessionList').then((m) => ({ default: m.SessionList })));
const NilaiList = lazy(() => import('./pages/guru/sessions/NilaiList'));
const SessionGrading = lazy(() => import('./pages/guru/sessions/SessionGrading').then((m) => ({ default: m.SessionGrading })));
const GuruMapelKkm = lazy(() => import('./pages/guru/MapelKkm').then((m) => ({ default: m.GuruMapelKkm })));
const ProktorDashboard = lazy(() => import('./pages/dashboards').then((m) => ({ default: m.ProktorDashboard })));

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="bg-scene min-h-screen">
        <Spinner />
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;
  return children;
}

const HOME_BY_ROLE: Record<string, string> = {
  ADMIN: '/app/admin',
  GURU: '/app/guru',
  PROKTOR: '/app/proktor',
  SISWA: '/app/siswa',
};

/** Guard per-role: backend tetap sumber kebenaran (403), tapi UI jangan
 *  membiarkan siswa membuka halaman guru/admin dan sebaliknya. */
function RequireRole({ roles, children }: { roles: string[]; children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="bg-scene min-h-screen">
        <Spinner />
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;
  if (!roles.includes(user.role)) return <Navigate to={HOME_BY_ROLE[user.role] ?? '/'} replace />;
  return children;
}

const roleOf = (el: ReactElement, ...roles: string[]) => (
  <RequireRole roles={roles}>{el}</RequireRole>
);

/** Permalink lama /app/guru/sesi/:id → panel pelaksanaan (pengaturan). */
function RedirectKePelaksanaan() {
  const { id = '' } = useParams();
  return <Navigate to={`/app/proktor/sesi/${id}/pengaturan`} replace />;
}

/** Tab awal panel pelaksanaan — guru tidak punya tab Token, langsung ke Pengaturan. */
function DefaultPelaksanaanTab() {
  const { user } = useAuth();
  return <Navigate to={user?.role === 'GURU' ? 'pengaturan' : 'token'} replace />;
}

export default function App() {
  return (
    <Suspense
      fallback={
        <div className="bg-scene min-h-screen">
          <Spinner />
        </div>
      }
    >
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/login/:role" element={<Login />} />
      <Route
        path="/ujian/:attemptId"
        element={
          <RequireRole roles={['SISWA']}>
            <ExamRoom />
          </RequireRole>
        }
      />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="admin" element={roleOf(<AdminHome />, 'ADMIN')} />
        <Route path="admin/pengguna" element={roleOf(<AdminUsers />, 'ADMIN')} />
        <Route path="admin/siswa" element={roleOf(<AdminSiswa />, 'ADMIN')} />
        <Route path="admin/mapel" element={roleOf(<AdminMapel />, 'ADMIN')} />
<Route path="admin/kelas" element={roleOf(<AdminKelas />, 'ADMIN')} />
        <Route path="admin/pengaturan" element={roleOf(<AdminSettings />, 'ADMIN')} />
        <Route path="admin/audit" element={roleOf(<AdminAuditLog />, 'ADMIN')} />
        <Route path="proktor/sesi/:sessionId" element={roleOf(<ProktorLayout />, 'PROKTOR', 'ADMIN', 'GURU')}>
        <Route index element={<DefaultPelaksanaanTab />} />
        <Route path="token" element={roleOf(<TokenPanel />, 'PROKTOR', 'ADMIN')} />
        <Route path="absensi" element={roleOf(<AttendancePanel />, 'PROKTOR', 'ADMIN', 'GURU')} />
        <Route path="pengaturan" element={roleOf(<SessionPengaturanWrapper />, 'PROKTOR', 'ADMIN', 'GURU')} />
        <Route path="integritas" element={roleOf(<IntegrityPanel />, 'PROKTOR', 'ADMIN', 'GURU')} />
        <Route path="monitoring" element={roleOf(<MonitoringPanel />, 'PROKTOR', 'ADMIN', 'GURU')} />
      </Route>
        <Route path="pelanggaran" element={roleOf(<PelanggaranPanel />, 'PROKTOR', 'ADMIN')} />
        <Route path="kehadiran" element={roleOf(<PresencePanel />, 'PROKTOR', 'ADMIN')} />
        <Route path="enrol-siswa" element={roleOf(<EnrolSiswa />, 'PROKTOR', 'ADMIN')} />
        <Route path="kartu" element={roleOf(<KartuPeserta />, 'PROKTOR', 'ADMIN')} />
        <Route path="guru" element={roleOf(<GuruHome />, 'GURU', 'ADMIN')} />
        <Route path="guru/soal" element={roleOf(<QuestionBank />, 'GURU', 'ADMIN')} />
        <Route path="guru/soal/baru" element={roleOf(<QuestionForm />, 'GURU', 'ADMIN')} />
        <Route path="guru/soal/:id/ubah" element={roleOf(<QuestionForm />, 'GURU', 'ADMIN')} />
        <Route path="guru/ujian" element={roleOf(<ExamList />, 'GURU', 'ADMIN')} />
        <Route path="guru/ujian/:id" element={roleOf(<ExamBuilder />, 'GURU', 'ADMIN')} />
        <Route path="guru/ujian/:id/pratinjau" element={roleOf(<ExamPreview />, 'GURU', 'ADMIN')} />
        <Route path="guru/sesi" element={roleOf(<SessionList />, 'GURU', 'ADMIN')} />
        <Route path="guru/nilai" element={roleOf(<NilaiList />, 'GURU', 'ADMIN')} />
        <Route path="guru/sesi/baru" element={roleOf(<SessionForm />, 'GURU', 'ADMIN')} />
        <Route path="guru/sesi/:id" element={roleOf(<RedirectKePelaksanaan />, 'GURU', 'ADMIN')} />
        <Route path="guru/sesi/:id/penilaian" element={roleOf(<SessionGrading />, 'GURU', 'ADMIN')} />
        <Route path="guru/mapel" element={roleOf(<GuruMapelKkm />, 'GURU', 'ADMIN')} />
        <Route path="siswa" element={roleOf(<SiswaUjian />, 'SISWA')} />
        <Route path="siswa/ujian" element={roleOf(<SiswaUjian />, 'SISWA')} />
        <Route path="akun" element={<Akun />} />
        <Route path="proktor" element={roleOf(<ProktorDashboard />, 'PROKTOR', 'ADMIN', 'GURU')} />
        <Route path="proktor/sesi" element={roleOf(<ProktorSesi />, 'PROKTOR', 'ADMIN', 'GURU')} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
  );
}
