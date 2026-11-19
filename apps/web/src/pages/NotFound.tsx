import { Link } from 'react-router-dom';
import { Button } from '../components/ui';

export function NotFound() {
  return (
    <div className="bg-scene flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-gradient text-7xl font-extrabold">404</p>
      <p className="text-slate-500 dark:text-slate-400">Halaman tidak ditemukan.</p>
      <Link to="/">
        <Button>Kembali ke beranda</Button>
      </Link>
    </div>
  );
}
