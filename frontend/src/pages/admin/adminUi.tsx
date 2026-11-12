// Small shared pieces for the administrator pages.
import { Badge } from 'react-bootstrap';

export const formatIp = (ip: string | null | undefined) => {
  if (!ip) return 'Unknown';
  if (ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1') return '127.0.0.1 (this computer)';
  return ip.replace('::ffff:', '');
};

export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');

const DANGER = /FAILED|LOCKED|BLOCKED|DELETE|REVOKED|DISABLED/;
const WARN = /PASSWORD|2FA|ADMIN_|ROLE/;
const OK = /^LOGIN$|VERIFIED|REGISTER|ENABLED|UNLOCKED|UNBLOCKED/;

// Colour by meaning: lifting a lock or block is good news, so it is checked before the "danger" words.
const toneOf = (action: string) =>
  /UNLOCKED|UNBLOCKED/.test(action) ? 'success' : DANGER.test(action) ? 'danger' : WARN.test(action) ? 'warning' : OK.test(action) ? 'success' : 'secondary';

export const ActionBadge = ({ action }: { action: string }) => {
  const tone = toneOf(action);
  return <Badge bg={tone} text={tone === 'warning' ? 'dark' : undefined} style={{ fontWeight: 600 }}>{action}</Badge>;
};

export const StatCard = ({ icon, label, value, tone }: { icon: string; label: string; value: number | string; tone?: 'danger' | 'warning' | 'success' }) => (
  <div className="card saas-card h-100">
    <div className="card-body">
      <div className="small d-flex align-items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
        <i className={`bi ${icon}`} aria-hidden="true"></i>{label}
      </div>
      <div className={`fs-2 fw-semibold ${tone ? `text-${tone}` : ''}`} style={tone ? undefined : { color: 'var(--text-primary)' }}>{value}</div>
    </div>
  </div>
);

export const thStyle = {
  color: 'var(--text-secondary)', textTransform: 'uppercase' as const, fontSize: '0.75rem', fontWeight: 600,
  letterSpacing: '0.05em', padding: '12px 16px', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--page-bg)',
};
export const tdStyle = { padding: '10px 16px', borderBottom: '1px solid var(--border)', verticalAlign: 'middle' as const };
