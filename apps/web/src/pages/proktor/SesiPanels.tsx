import { useParams } from 'react-router-dom';
import SessionSettingsPanel from './SessionSettingsPanel';

/** Pengaturan pelaksanaan — versi panel proktor. */
export function SessionPengaturanWrapper() {
  const { sessionId = '' } = useParams();
  return <SessionSettingsPanel sessionId={sessionId} />;
}
