/**
 * Status vocabulary → semantic tone (WS-25A foundation).
 *
 * One mapping from the platform's status strings to a semantic tone, shared by
 * StatusBadge and any page that needs the tone without the badge. Unknown
 * statuses fall back to neutral — never to a colour that implies a meaning the
 * platform did not assign.
 */
export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_BY_STATUS: Record<string, StatusTone> = {
  // success
  active: 'success',
  approved: 'success',
  healthy: 'success',
  completed: 'success',
  complete: 'success',
  enabled: 'success',
  verified: 'success',
  succeeded: 'success',
  success: 'success',
  accepted: 'success',
  paid: 'success',
  present: 'success',
  // warning
  trial: 'warning',
  pending: 'warning',
  warning: 'warning',
  degraded: 'warning',
  stale: 'warning',
  expiring: 'warning',
  awaiting: 'warning',
  on_hold: 'warning',
  'on hold': 'warning',
  overdue: 'warning',
  late: 'warning',
  partial: 'warning',
  // danger
  suspended: 'danger',
  rejected: 'danger',
  revoked: 'danger',
  critical: 'danger',
  unhealthy: 'danger',
  failed: 'danger',
  error: 'danger',
  cancelled: 'danger',
  canceled: 'danger',
  blocked: 'danger',
  terminated: 'danger',
  absent: 'danger',
  // info
  invited: 'info',
  in_review: 'info',
  'in review': 'info',
  under_review: 'info',
  running: 'info',
  scheduled: 'info',
  submitted: 'info',
  in_progress: 'info',
  'in progress': 'info',
  open: 'info',
  new: 'info',
  // neutral
  expired: 'neutral',
  draft: 'neutral',
  unknown: 'neutral',
  disabled: 'neutral',
  archived: 'neutral',
  inactive: 'neutral',
  closed: 'neutral',
  none: 'neutral',
};

export function toneForStatus(status: string | null | undefined): StatusTone {
  if (!status) return 'neutral';
  return TONE_BY_STATUS[status.trim().toLowerCase()] ?? 'neutral';
}

/** "in_progress" → "In progress"; "on-hold" → "On hold". */
export function formatStatusLabel(status: string): string {
  const s = status.replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
