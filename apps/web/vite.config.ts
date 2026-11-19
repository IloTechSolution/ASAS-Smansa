import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Pecah vendor besar agar bundle awal kecil; halaman dimuat lazy per rute.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('socket.io-client')) return 'socket';
          if (/[\\/]react(-dom|-router-dom)?[\\/]/.test(id)) return 'react';
          return 'vendor';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Dev: request ke /api diteruskan ke NestJS agar bebas CORS.
      '/api': 'http://localhost:3000',
      // Gambar upload (soal, avatar) juga dari NestJS.
      '/uploads': 'http://localhost:3000',
      // Socket.io monitoring realtime (Fase 6) — butuh WebSocket.
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
});
