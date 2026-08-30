import { Link } from 'wouter';
import {
  Compass,
  Users,
  ClipboardCheck,
  Boxes,
  GraduationCap,
  ClipboardList,
  CalendarClock,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/query-error';
import {
  useGetMe,
  getGetMeQueryKey,
  useGetManagerPortalTeam,
  getGetManagerPortalTeamQueryKey,
  useGetManagerPortalDashboard,
  getGetManagerPortalDashboardQueryKey,
  useGetManagerPortalPendingActions,
  getGetManagerPortalPendingActionsQueryKey,
  type ManagerPortalTeamMember,
  type ManagerPortalPendingActionItem,
  type ManagerPortalPendingActions,
} from '@workspace/api-client-react';

// Manager Portal (Phase 3G, W111 -- frozen plan: docs/PHASE_3G_MANAGER_PORTAL_IMPLEMENTATION_PLAN.md).
//
// This page is an ORCHESTRATION SURFACE ONLY: it renders exactly what the
// W109/W110 read-only endpoints return, and every actionable item deep-links
// to its own authoritative module page (Leave Approvals, My Team Reviews,
// My Team Training) rather than embedding a second implementation of any
// module's own approve/reject/assign workflow (frozen plan §19/§23 --
// the Manager Portal must never widen or duplicate module authority). There
// is no mutation hook, no mutation button, and no client-side recomputation
// of any count or authority decision anywhere in this file -- every number
// and every included/excluded item was already decided server-side.
//
// NULL vs ZERO (frozen plan, W110's own contract): a dashboard tile is
// `null` when its own module is disabled, the caller lacks that module's
// own permission, or (Attendance only) the organization's timezone isn't
// configured -- three different causes collapsed into one signal by design.
// Since the DTO itself doesn't distinguish which cause applies, this page
// renders one honest, deliberately generic "Unavailable" state for every
// null tile rather than guessing a specific reason (e.g. never claims
// "timezone not configured" when the true cause might be module-disabled).
//
// PROFILE PICTURES: W109's Team Overview returns `hasProfilePicture` as a
// boolean only -- no URL, no file key. The existing authenticated
// GET .../employees/:employeeId/profile-picture route requires only the
// broad, un-narrowed `employee.read` permission (a disclosed pre-existing
// gap, frozen plan §22/§18 -- "Manager Portal must avoid depending on that
// broad DTO"). Wiring that route into My Team would make this page depend
// on that same broad gate to fetch actual image bytes, which the frozen
// plan does not authorize. This page therefore always renders an initials
// avatar for team members (matching employees.tsx's own established
// fallback pattern) and never loads a team member's actual photo.
export default function ManagerPortal() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const enabled = organizationId > 0;

  const dashboardQuery = useGetManagerPortalDashboard(organizationId, {
    query: { queryKey: getGetManagerPortalDashboardQueryKey(organizationId), enabled },
  });
  const teamQuery = useGetManagerPortalTeam(organizationId, {
    query: { queryKey: getGetManagerPortalTeamQueryKey(organizationId), enabled },
  });
  const pendingQuery = useGetManagerPortalPendingActions(organizationId, {
    query: { queryKey: getGetManagerPortalPendingActionsQueryKey(organizationId), enabled },
  });

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <Compass className="h-7 w-7 text-primary" aria-hidden="true" />
          Manager Portal
        </h1>
        <p className="text-muted-foreground">
          A summary of your team, at-a-glance metrics, and pending work across Leave, Performance, and Learning. Every action opens the module's own page -- nothing is approved or changed here.
        </p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-manager-overview">Overview</TabsTrigger>
          <TabsTrigger value="my-team" data-testid="tab-manager-my-team">My Team</TabsTrigger>
          <TabsTrigger value="pending-actions" data-testid="tab-manager-pending-actions">Pending Actions</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewSection query={dashboardQuery} />
        </TabsContent>

        <TabsContent value="my-team">
          <MyTeamSection query={teamQuery} />
        </TabsContent>

        <TabsContent value="pending-actions">
          <PendingActionsSection query={pendingQuery} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- Overview ---

interface DashboardQueryResult {
  data?: {
    linked: boolean;
    directReportsCount: number;
    attendanceAbsentOrLateTodayCount: number | null;
    pendingLeaveActionsCount: number | null;
    pendingPerformanceActionsCount: number | null;
    pendingLearningActionsCount: number | null;
    teamAssetsInCustodyCount: number | null;
  };
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}

function OverviewSection({ query }: { query: DashboardQueryResult }) {
  if (query.isLoading) {
    return (
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true" aria-label="Loading dashboard">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }
  if (query.error) {
    return (
      <div className="mt-6">
        <QueryError title="Could not load your dashboard" message="Could not fetch your Manager Portal summary. Try again." onRetry={() => query.refetch()} />
      </div>
    );
  }
  const d = query.data;
  if (!d) return null;

  if (!d.linked) {
    return (
      <div className="mt-6">
        <NotLinkedCard />
      </div>
    );
  }

  return (
    <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <DashboardTile testId="direct-reports" icon={Users} label="Direct Reports" value={d.directReportsCount} />
      <DashboardTile testId="attendance" icon={CalendarClock} label="Absent or Late Today" value={d.attendanceAbsentOrLateTodayCount} href="/attendance-register" />
      <DashboardTile testId="leave" icon={ClipboardCheck} label="Pending Leave Actions" value={d.pendingLeaveActionsCount} href="/leave-approvals" />
      <DashboardTile testId="performance" icon={ClipboardList} label="Pending Performance Actions" value={d.pendingPerformanceActionsCount} href="/performance-team" />
      <DashboardTile testId="learning" icon={GraduationCap} label="Pending Learning Actions" value={d.pendingLearningActionsCount} href="/learning-team-training" />
      <DashboardTile testId="assets" icon={Boxes} label="Team Assets In Custody" value={d.teamAssetsInCustodyCount} href="/team-assets" />
    </div>
  );
}

function DashboardTile({
  testId,
  icon: Icon,
  label,
  value,
  href,
}: {
  testId: string;
  icon: React.ElementType;
  label: string;
  value: number | null;
  href?: string;
}) {
  const unavailable = value === null;
  const content = (
    <Card className={href && !unavailable ? 'transition-colors hover:border-primary/50' : undefined} data-testid={`card-manager-tile-${testId}`}>
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0">
            <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground truncate">{label}</p>
            {unavailable ? (
              <p className="text-sm font-medium text-muted-foreground" data-testid={`text-manager-tile-unavailable-${testId}`}>
                Unavailable
              </p>
            ) : (
              <p className="text-2xl font-bold text-foreground" data-testid={`text-manager-tile-value-${testId}`}>
                {value}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (href && !unavailable) {
    return (
      <Link href={href} data-testid={`link-manager-tile-${testId}`} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg block">
        {content}
      </Link>
    );
  }
  return content;
}

// --- My Team ---

interface TeamQueryResult {
  data?: { linked: boolean; directReports: ManagerPortalTeamMember[] };
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}

function MyTeamSection({ query }: { query: TeamQueryResult }) {
  if (query.isLoading) {
    return (
      <div className="mt-6 space-y-3" aria-busy="true" aria-label="Loading your team">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }
  if (query.error) {
    return (
      <div className="mt-6">
        <QueryError title="Could not load your team" message="Could not fetch your direct reports. Try again." onRetry={() => query.refetch()} />
      </div>
    );
  }
  const t = query.data;
  if (!t) return null;

  if (!t.linked) {
    return (
      <div className="mt-6">
        <NotLinkedCard />
      </div>
    );
  }

  if (t.directReports.length === 0) {
    return (
      <div className="mt-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <Users className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2" data-testid="text-manager-team-empty">
              You currently have no direct reports
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              When someone reports to you, they'll appear here automatically.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <Card>
        <Table aria-label="My team">
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Position</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {t.directReports.map((member) => (
              <TableRow key={member.id} data-testid={`row-manager-team-${member.id}`}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                        {member.firstName[0]}
                        {member.lastName[0]}
                      </AvatarFallback>
                    </Avatar>
                    <span>
                      {member.firstName} {member.lastName}
                      {member.employeeNumber ? <span className="text-muted-foreground"> ({member.employeeNumber})</span> : null}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{member.positionName ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{member.departmentName ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{member.branchName ?? '—'}</TableCell>
                <TableCell>
                  <Badge variant="secondary" data-testid={`badge-manager-team-status-${member.id}`}>
                    {member.employmentStatus}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// --- Pending Actions ---

interface PendingActionsQueryResult {
  // The generated response type, so the additive WS-15 P2
  // `recruitmentParticipation` field is visible here without restating the
  // shape by hand (§31.28).
  data?: ManagerPortalPendingActions;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}

const SOURCE_MODULE_LABEL: Record<ManagerPortalPendingActionItem['sourceModule'], string> = {
  leave: 'Leave',
  performance: 'Performance',
  learning: 'Learning',
};
const SOURCE_MODULE_HREF: Record<ManagerPortalPendingActionItem['sourceModule'], string> = {
  leave: '/leave-approvals',
  performance: '/performance-team',
  learning: '/learning-team-training',
};

/**
 * WS-15 P2 (§31.28) — Recruitment participation labels.
 *
 * A row says what the caller is involved in and links to the Recruitment
 * surface that owns it. It never carries a candidate name, an application
 * detail, another panel member's scoring or offered compensation.
 */
const RECRUITMENT_KIND_LABEL: Record<string, string> = {
  interview_scorecard: 'Scorecard due',
  interview_panel: 'Interview panel',
  job_requisition: 'My requisition',
};

function PendingActionsSection({ query }: { query: PendingActionsQueryResult }) {
  if (query.isLoading) {
    return (
      <div className="mt-6 space-y-3" aria-busy="true" aria-label="Loading pending actions">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }
  if (query.error) {
    return (
      <div className="mt-6">
        <QueryError title="Could not load pending actions" message="Could not fetch your team's pending work. Try again." onRetry={() => query.refetch()} />
      </div>
    );
  }
  const p = query.data;
  if (!p) return null;

  const recruitment = p.recruitmentParticipation ?? [];

  // An unlinked caller can still hold an interview panel seat — panel membership
  // keys on the MEMBERSHIP, not the employee record — so the not-linked card
  // only applies when there is genuinely nothing to show.
  if (!p.linked && p.items.length === 0 && recruitment.length === 0) {
    return (
      <div className="mt-6">
        <NotLinkedCard />
      </div>
    );
  }

  if (p.items.length === 0 && recruitment.length === 0) {
    return (
      <div className="mt-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <ClipboardCheck className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2" data-testid="text-manager-pending-empty">
              Nothing pending
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Your team has no pending Leave, Performance, or Learning actions right now.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-3">
      {recruitment.length > 0 && (
        <div className="space-y-3" data-testid="list-manager-recruitment">
          <p className="text-sm font-medium text-muted-foreground">Recruitment</p>
          {recruitment.map((item) => (
            <Card key={`${item.kind}-${item.id}`} data-testid={`row-manager-recruitment-${item.kind}-${item.id}`}>
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" data-testid={`badge-manager-recruitment-kind-${item.kind}-${item.id}`}>
                      {RECRUITMENT_KIND_LABEL[item.kind] ?? item.kind}
                    </Badge>
                    <Badge variant="secondary">{item.status}</Badge>
                  </div>
                  <p className="font-medium text-foreground truncate">{item.title}</p>
                  <p className="text-sm text-muted-foreground truncate">
                    {new Date(item.occurredAt).toLocaleDateString()}
                  </p>
                </div>
                <Button asChild variant="outline" size="sm" data-testid={`link-manager-recruitment-open-${item.kind}-${item.id}`}>
                  {/* Recruitment re-gates at the destination — this link grants nothing. */}
                  <Link href={item.deepLink}>Open in Recruitment</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {p.items.map((item) => (
        <Card key={`${item.sourceModule}-${item.id}`} data-testid={`row-manager-pending-${item.sourceModule}-${item.id}`}>
          <CardContent className="flex items-center justify-between gap-4 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" data-testid={`badge-manager-pending-source-${item.sourceModule}-${item.id}`}>
                  {SOURCE_MODULE_LABEL[item.sourceModule]}
                </Badge>
                <Badge variant="secondary" data-testid={`badge-manager-pending-status-${item.sourceModule}-${item.id}`}>
                  {item.status}
                </Badge>
              </div>
              <p className="font-medium text-foreground truncate">{item.title}</p>
              <p className="text-sm text-muted-foreground truncate">
                {item.employeeFirstName} {item.employeeLastName} &middot; {new Date(item.createdAt).toLocaleDateString()}
              </p>
            </div>
            <Button asChild variant="outline" size="sm" data-testid={`link-manager-pending-open-${item.sourceModule}-${item.id}`}>
              <Link href={SOURCE_MODULE_HREF[item.sourceModule]}>Open in {SOURCE_MODULE_LABEL[item.sourceModule]}</Link>
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// --- Shared ---

function NotLinkedCard() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
          <Users className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2" data-testid="text-manager-not-linked">
          Not linked to an employee record
        </h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Your user account has not yet been linked to an employee record. Please contact your HR administrator.
        </p>
      </CardContent>
    </Card>
  );
}
