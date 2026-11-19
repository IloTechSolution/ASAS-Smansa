import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';

/**
 * Koneksi Socket.io realtime (Fase 6) ke namespace `/monitoring`.
 * Server menerima token JWT yang sama dengan `Authorization: Bearer`.
 */
let socket: Socket | null = null;

export function getMonitorSocket(): Socket {
  if (socket) return socket;
  socket = io('/monitoring', {
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
    transports: ['websocket', 'polling'],
    auth: (cb) => {
      const school = (localStorage.getItem('cbt_school_id') ?? '').trim();
      cb({ token: localStorage.getItem('cbt_token') ?? '', ...(school ? { schoolId: school } : {}) });
    },
  });
  return socket;
}

export function connectMonitor(): Socket {
  const s = getMonitorSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectMonitor(): void {
  // Lepas singleton sepenuhnya — termasuk socket yang masih menghubungkan
  // (sebelumnya hanya `connected` yang ditangani sehingga socket setengah
  // jadi selamat dari cleanup dan menumpuk listener).
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
