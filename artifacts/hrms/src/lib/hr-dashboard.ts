import type {
  DashboardSummary,
  HrAttentionCard,
  HrAttentionCardKey,
  HrCommandCentre,
  HrTask,
  OrganizationModule,
} from '@workspace/api-client-react';
import { isModuleAccessible } from '@/lib/module-access';

/**
 * HR Dashboard Command Centre — pure presentation rules (no React), so the
 * visibility and labelling decisions are unit-testable in isolation.
 *
 * NOTHING HERE AUTHORIZES. The server decides what data a caller receives and
 * re-gates every destination. These rules only decide what to ADVERTISE:
 * a Quick Access card appears only when the destination's module is enabled
 * for the active organization AND the caller holds a permission the
 * destination actually requires (MembershipSummary.permissions — effective
 * keys, never role names). Missing data fails closed: no permissions or no
 * module list means no gated card.
 *
 * RELATIONSHIP-AWARE CARDS. Some keys only let the holder ATTEMPT an action or
 * see a TEAM-scoped view: leave_request.approve and office_inventory.approve
 * are held by every employee, but only a department head (or a valid inventory
 * delegate) can actually act; the *.reports.read keys narrow to the caller's own
 * and direct-report records. Advertising a manager or HR card to anyone holding
 * such a key misleads an ordinary employee, so those keys open a card only
 * together with the structural relationship that gives them meaning
 * (MembershipSummary.isDepartmentHead / hasDirectReports /
 * isInventoryApprovalDelegate). The organization-wide key (…manage) still opens
 * the card on its own.
 */

export type WorkspaceKey =
  | 'employees'
  | 'personnel_files'
  | 'leave'
  | 'attendance'
  | 'performance'
  | 'learning'
  | 'recruitment'
  | 'assets'
  | 'office_inventory'
  | 'forms'
  | 'reports'
  | 'self_service'
  | 'branches'
  | 'departments'
  | 'positions';

/** Structural authority reported by MembershipSummary — never a permission, never a role name. */
export type Relationship = 'isDepartmentHead' | 'hasDirectReports' | 'isInventoryApprovalDelegate';
export type Relationships = Partial<Record<Relationship, boolean>>;

interface Destination {
  href: string;
  moduleKey?: string;
  /**
   * The caller must hold at least one; an empty list (with no relationshipGated
   * rule) means membership (plus module) suffices.
   */
  anyPermission: readonly string[];
  /**
   * Attempt-only or team-scoped keys: they open the destination only when the
   * caller ALSO holds one of the listed relationships.
   */
  relationshipGated?: { anyPermission: readonly string[]; anyRelationship: readonly Relationship[] };
}

export interface WorkspaceEntry extends Destination {
  key: WorkspaceKey;
  title: string;
  description: string;
}

/**
 * Catalog order is display order: daily HR work first, master data last.
 * Permission keys mirror each destination route's own server gate, except where
 * the HR workspace deliberately advertises the management view (attendance,
 * master data) rather than the self-service one every member holds.
 */
/** A department head or reporting manager — the relationships behind every team-scoped view. */
const MANAGER_RELATIONSHIPS: readonly Relationship[] = ['isDepartmentHead', 'hasDirectReports'];

export const HR_WORKSPACE: readonly WorkspaceEntry[] = [
  { key: 'employees', title: 'Employees', description: 'Directory and employee records', href: '/employees', anyPermission: ['employee.read'] },
  {
    key: 'leave',
    title: 'Leave',
    description: 'Approvals, calendar and balances',
    href: '/leave-approvals',
    moduleKey: 'leave',
    anyPermission: ['leave_request.manage'],
    relationshipGated: { anyPermission: ['leave_request.approve'], anyRelationship: ['isDepartmentHead'] },
  },
  { key: 'attendance', title: 'Attendance', description: "Today's attendance and exceptions", href: '/attendance-dashboard', moduleKey: 'attendance', anyPermission: ['attendance.manage'] },
  { key: 'forms', title: 'Forms', description: 'Submissions and workflow reviews', href: '/forms', anyPermission: ['form.read'] },
  { key: 'personnel_files', title: 'Personnel Files', description: 'File custody and personnel reports', href: '/personnel-reports', anyPermission: ['personnel_file.read'] },
  { key: 'performance', title: 'Performance', description: 'Review cycles and HR review', href: '/performance-reviews', moduleKey: 'performance', anyPermission: ['performance.manage'] },
  {
    key: 'learning',
    title: 'Learning & Development',
    description: 'Courses, enrolments and training',
    href: '/learning',
    moduleKey: 'learning',
    anyPermission: ['learning.manage'],
    relationshipGated: { anyPermission: ['learning.reports.read'], anyRelationship: MANAGER_RELATIONSHIPS },
  },
  { key: 'recruitment', title: 'Recruitment', description: 'Requisitions, vacancies and pipeline', href: '/recruitment', moduleKey: 'recruitment', anyPermission: ['recruitment.reports.read'] },
  {
    key: 'assets',
    title: 'Asset Management',
    description: 'Assignments, returns and incidents',
    href: '/assets-dashboard',
    moduleKey: 'asset_management',
    anyPermission: ['asset_management.manage'],
    relationshipGated: { anyPermission: ['asset_management.reports.read'], anyRelationship: MANAGER_RELATIONSHIPS },
  },
  {
    key: 'office_inventory',
    title: 'Office Inventory',
    description: 'Stock, issuing and requests',
    href: '/office-inventory',
    moduleKey: 'office_inventory',
    anyPermission: ['office_inventory.item.manage', 'office_inventory.reports.read', 'office_inventory.issue'],
    relationshipGated: {
      anyPermission: ['office_inventory.approve'],
      anyRelationship: ['isDepartmentHead', 'isInventoryApprovalDelegate'],
    },
  },
  { key: 'self_service', title: 'Employee Self-Service', description: 'Your own requests, leave and documents', href: '/self-service', moduleKey: 'employee_self_service', anyPermission: [] },
  { key: 'branches', title: 'Branches', description: 'Locations and regional offices', href: '/branches', anyPermission: ['branch.manage'] },
  { key: 'departments', title: 'Departments', description: 'Organisational units', href: '/departments', anyPermission: ['department.manage'] },
  { key: 'positions', title: 'Positions', description: 'Job titles and roles', href: '/positions', anyPermission: ['position.manage'] },
];

/** Report areas, each with its own module and reporting permission. The Reports card opens the first one available. */
export const REPORT_DESTINATIONS: readonly Destination[] = [
  { href: '/personnel-reports', anyPermission: ['personnel_file.read'] },
  { href: '/attendance-reports', moduleKey: 'attendance', anyPermission: ['attendance.manage'] },
  {
    href: '/performance-reports',
    moduleKey: 'performance',
    anyPermission: ['performance.manage'],
    relationshipGated: { anyPermission: ['performance.reports.read'], anyRelationship: MANAGER_RELATIONSHIPS },
  },
  {
    href: '/learning-reports',
    moduleKey: 'learning',
    anyPermission: ['learning.manage'],
    relationshipGated: { anyPermission: ['learning.reports.read'], anyRelationship: MANAGER_RELATIONSHIPS },
  },
  {
    href: '/asset-reports',
    moduleKey: 'asset_management',
    anyPermission: ['asset_management.manage'],
    relationshipGated: { anyPermission: ['asset_management.reports.read'], anyRelationship: MANAGER_RELATIONSHIPS },
  },
  { href: '/recruitment-reports', moduleKey: 'recruitment', anyPermission: ['recruitment.reports.read'] },
];

export function canOpenDestination(
  destination: Destination,
  modules: readonly OrganizationModule[] | undefined,
  permissions: readonly string[] | undefined,
  relationships?: Relationships,
): boolean {
  if (destination.moduleKey && (!modules || !isModuleAccessible([...modules], destination.moduleKey))) return false;
  const gated = destination.relationshipGated;
  if (destination.anyPermission.length === 0 && !gated) return true;
  if (!permissions) return false;
  if (destination.anyPermission.some((key) => permissions.includes(key))) return true;
  // Missing relationship data means no relationship — fail closed.
  return (
    gated !== undefined &&
    gated.anyPermission.some((key) => permissions.includes(key)) &&
    gated.anyRelationship.some((r) => relationships?.[r] === true)
  );
}

export type BadgeTone = 'warning' | 'neutral';

export interface WorkspaceCard {
  key: WorkspaceKey;
  title: string;
  description: string;
  href: string;
  badge: { text: string; tone: BadgeTone };
}

function plural(n: number, singular: string, pluralWord = `${singular}s`) {
  return `${n} ${n === 1 ? singular : pluralWord}`;
}

function countBadge(count: number | null | undefined, label: (n: number) => string): WorkspaceCard['badge'] {
  if (count == null) return { text: 'Open', tone: 'neutral' };
  if (count === 0) return { text: 'No pending items', tone: 'neutral' };
  return { text: label(count), tone: 'warning' };
}

function attentionCount(commandCentre: HrCommandCentre | undefined, key: HrAttentionCardKey): number | null {
  return commandCentre?.attention.find((c) => c.key === key)?.count ?? null;
}

/**
 * The operational badge for a workspace card — a real count from data the
 * caller already received, or "Open" where no count exists. Never invented.
 */
export function workspaceBadge(key: WorkspaceKey, summary: DashboardSummary | undefined, commandCentre: HrCommandCentre | undefined): WorkspaceCard['badge'] {
  switch (key) {
    case 'leave':
      return countBadge(summary?.leaveMetrics?.awaitingMyActionCount, (n) => `${n} pending`);
    case 'attendance':
      return countBadge(attentionCount(commandCentre, 'attendance_exceptions'), (n) => plural(n, 'exception'));
    case 'performance':
      return countBadge(attentionCount(commandCentre, 'performance_reviews_due'), (n) => `${n} due`);
    case 'personnel_files':
      return countBadge(attentionCount(commandCentre, 'personnel_files_attention'), (n) => `${n} overdue`);
    case 'assets':
      return countBadge(attentionCount(commandCentre, 'assets_awaiting_return'), (n) => plural(n, 'overdue return'));
    case 'forms':
      return countBadge(attentionCount(commandCentre, 'forms_awaiting_review'), (n) => `${n} awaiting you`);
    default:
      return { text: 'Open', tone: 'neutral' };
  }
}

export function resolveWorkspaceCards(input: {
  modules: readonly OrganizationModule[] | undefined;
  permissions: readonly string[] | undefined;
  relationships?: Relationships;
  summary?: DashboardSummary;
  commandCentre?: HrCommandCentre;
}): WorkspaceCard[] {
  const cards: WorkspaceCard[] = [];
  for (const entry of HR_WORKSPACE) {
    if (!canOpenDestination(entry, input.modules, input.permissions, input.relationships)) continue;
    cards.push({
      key: entry.key,
      title: entry.title,
      description: entry.description,
      href: entry.href,
      badge: workspaceBadge(entry.key, input.summary, input.commandCentre),
    });
    // Reports sits after the operational modules, before self-service and master data.
    if (entry.key === 'office_inventory') pushReports(cards, input);
  }
  if (!cards.some((c) => c.key === 'reports')) pushReports(cards, input, true);
  return cards;
}

function pushReports(cards: WorkspaceCard[], input: Parameters<typeof resolveWorkspaceCards>[0], atEndOfOperational = false) {
  const available = REPORT_DESTINATIONS.filter((d) => canOpenDestination(d, input.modules, input.permissions, input.relationships));
  if (available.length === 0) return;
  const card: WorkspaceCard = {
    key: 'reports',
    title: 'Reports',
    description: available.length === 1 ? '1 report area available' : `${available.length} report areas available`,
    href: available[0]!.href,
    badge: { text: 'Open', tone: 'neutral' },
  };
  if (!atEndOfOperational) {
    cards.push(card);
    return;
  }
  // The inventory card was not shown: place Reports before self-service/master data.
  const insertAt = cards.findIndex((c) => ['self_service', 'branches', 'departments', 'positions'].includes(c.key));
  cards.splice(insertAt === -1 ? cards.length : insertAt, 0, card);
}

// ---------------------------------------------------------------------------
// Attention cards
// ---------------------------------------------------------------------------

export const ATTENTION_ORDER: readonly HrAttentionCardKey[] = [
  'forms_awaiting_review',
  'attendance_exceptions',
  'probation_reviews_due',
  'performance_reviews_due',
  'personnel_files_attention',
  'assets_awaiting_return',
];

export const ATTENTION_META: Record<HrAttentionCardKey, { title: string; supporting: string }> = {
  attendance_exceptions: { title: 'Attendance Exceptions', supporting: 'Late, partial or absent today' },
  probation_reviews_due: { title: 'Probation Reviews Due', supporting: 'Ending soon or past end date' },
  performance_reviews_due: { title: 'Performance Reviews Due', supporting: 'Awaiting HR review' },
  personnel_files_attention: { title: 'Personnel Files Requiring Attention', supporting: 'Checked out past expected return' },
  assets_awaiting_return: { title: 'Assets Awaiting Return', supporting: 'Past expected return date' },
  forms_awaiting_review: { title: 'Forms Awaiting HR Review', supporting: 'Currently at your stage' },
};

export function orderedAttention(cards: readonly HrAttentionCard[]): HrAttentionCard[] {
  return [...cards].sort((a, b) => ATTENTION_ORDER.indexOf(a.key) - ATTENTION_ORDER.indexOf(b.key));
}

export function attentionSupporting(card: HrAttentionCard): string {
  if (card.key === 'forms_awaiting_review' && card.secondaryCount != null && card.secondaryCount > 0) {
    return `${card.secondaryCount} elsewhere in workflow`;
  }
  return ATTENTION_META[card.key].supporting;
}

// ---------------------------------------------------------------------------
// Tasks, activity and dates
// ---------------------------------------------------------------------------

export const TASK_SOURCE_LABEL: Record<HrTask['sourceModule'], string> = {
  leave: 'Leave',
  learning: 'Learning',
  onboarding: 'Onboarding',
  skills: 'Skills',
  performance: 'Performance',
  recruitment: 'Recruitment',
  employee_requests: 'Employee requests',
  employee_relations: 'Employee relations',
  succession: 'Succession',
  employment_lifecycle: 'Employment',
  forms: 'Forms',
};

const DAY_MS = 86_400_000;

export function formatShortDate(value: string | Date): string {
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Whole days from `from` to `to`, never negative. */
export function daysBetween(from: string | Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - new Date(from).getTime()) / DAY_MS));
}

export type TaskTiming = { tone: 'danger' | 'warning' | 'neutral'; text: string };

/**
 * The task's timing line. Overdue and due-soon come only from the source's own
 * `dueAt`; an undated task shows how long it has waited — never a fabricated
 * deadline.
 */
export function taskTiming(task: Pick<HrTask, 'dueAt' | 'overdue' | 'createdAt'>, now: Date): TaskTiming {
  if (task.dueAt && task.overdue) return { tone: 'danger', text: `Overdue · due ${formatShortDate(task.dueAt)}` };
  if (task.dueAt) return { tone: 'warning', text: `Due ${formatShortDate(task.dueAt)}` };
  const days = daysBetween(task.createdAt, now);
  return { tone: 'neutral', text: days === 0 ? 'Waiting since today' : `Waiting ${plural(days, 'day')}` };
}

export function employeeName(task: Pick<HrTask, 'employeeFirstName' | 'employeeLastName'>): string | null {
  const name = [task.employeeFirstName, task.employeeLastName].filter(Boolean).join(' ');
  return name || null;
}

/** "leave_request.department_head_approved" → "Leave request department head approved". */
export function humanizeEventType(eventType: string): string {
  const text = eventType.replace(/[._]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function relativeDays(value: string, now: Date): string {
  const days = Math.round((new Date(`${value}T00:00:00`).getTime() - new Date(now.toDateString()).getTime()) / DAY_MS);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}
