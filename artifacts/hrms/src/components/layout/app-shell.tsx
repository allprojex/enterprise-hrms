import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Building2,
  LayoutDashboard,
  Bell,
  Settings,
  Search,
  Menu,
  X,
  LogOut,
  ChevronDown,
  Building,
  MapPin,
  Network,
  Briefcase,
  Users,
  ShieldCheck,
  Check,
  CalendarDays,
  CalendarClock,
  Wallet,
  ClipboardCheck,
  CalendarRange,
  CalendarHeart,
  Clock,
  UserPlus,
  ClipboardList,
  Stamp,
  Megaphone,
  UserCheck,
  LayoutGrid,
  Users2,
  Video,
  FileSignature,
  FileBarChart,
  ListChecks,
  Ruler,
  FileText,
  GraduationCap,
  Boxes,
  Compass,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  useGetMe,
  getGetMeQueryKey,
  useListNotifications,
  getListNotificationsQueryKey,
  useListMyOrganizations,
  getListMyOrganizationsQueryKey,
  useSwitchOrganization,
  useLogout,
  type MembershipSummary,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { clearToken } from '@/lib/auth';
import { motion, AnimatePresence } from 'framer-motion';

interface AppShellProps {
  children: React.ReactNode;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  badge?: number;
}

function NavLinks({
  items,
  location,
  onNavigate,
}: {
  items: NavItem[];
  location: string;
  onNavigate?: () => void;
}) {
  return (
    <ul className="space-y-1" role="list">
      {items.map((item) => {
        const isActive = location === item.href;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-border/50'
              }`}
              aria-current={isActive ? 'page' : undefined}
              data-testid={`link-nav-${item.label.toLowerCase()}`}
              onClick={onNavigate}
            >
              <item.icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
              <span>{item.label}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-auto h-5 min-w-5 px-1 text-xs"
                  aria-label={`${item.badge} unread`}
                >
                  {item.badge}
                </Badge>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function OrgLabel({ currentOrg }: { currentOrg: MembershipSummary }) {
  return (
    <div className="border-b border-sidebar-border px-4 py-3">
      <div
        className="flex items-center gap-2 rounded-lg border border-sidebar-border bg-card px-3 py-2"
        data-testid="text-org-current"
      >
        <Building className="h-4 w-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
        <span className="text-sm font-medium text-card-foreground truncate">{currentOrg.organizationName}</span>
      </div>
    </div>
  );
}

function OrgSwitcher({
  currentOrg,
  organizations,
  disabled,
  onSwitch,
}: {
  currentOrg: MembershipSummary;
  organizations: MembershipSummary[];
  disabled: boolean;
  onSwitch: (organization: MembershipSummary) => void;
}) {
  return (
    <div className="border-b border-sidebar-border px-4 py-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-sidebar-border bg-card px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            aria-label={`Current organisation: ${currentOrg.organizationName}. Switch organisation`}
            disabled={disabled}
            data-testid="button-org-selector"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Building className="h-4 w-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
              <span className="text-sm font-medium text-card-foreground truncate">
                {currentOrg.organizationName}
              </span>
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Switch organisation</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {organizations.map((org) => (
            <DropdownMenuItem
              key={org.organizationId}
              onSelect={() => onSwitch(org)}
              data-testid={`option-org-${org.organizationId}`}
            >
              <span className="flex-1 truncate">{org.organizationName}</span>
              {org.organizationId === currentOrg.organizationId && (
                <Check className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function AppShell({ children }: AppShellProps) {
  const [location, setLocation] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    data: user,
    isLoading: userLoading,
    error: userError,
  } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });

  const { data: notifications } = useListNotifications({
    query: { queryKey: getListNotificationsQueryKey() },
  });

  const { data: myOrganizations } = useListMyOrganizations({
    query: { queryKey: getListMyOrganizationsQueryKey() },
  });

  const logoutMutation = useLogout();
  const switchOrganizationMutation = useSwitchOrganization();

  // Redirect to login when session is invalid or expired.
  useEffect(() => {
    if (userError && 'status' in userError && userError.status === 401) {
      clearToken();
      setLocation('/login');
    }
  }, [userError, setLocation]);

  // Move focus to the close button when the mobile sidebar opens.
  useEffect(() => {
    if (sidebarOpen) {
      closeButtonRef.current?.focus();
    }
  }, [sidebarOpen]);

  // Close the sidebar on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidebarOpen) {
        setSidebarOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        clearToken();
        queryClient.clear();
        setLocation('/login');
        toast({ title: 'Logged out successfully' });
      },
      onError: () => {
        // Even if the server call fails, clear the local token so the user
        // is not stuck in an authenticated-looking state.
        clearToken();
        queryClient.clear();
        setLocation('/login');
      },
    });
  };

  const unreadCount = notifications?.filter((n) => !n.read).length ?? 0;
  const activeOrganizationId = user?.activeOrganizationId ?? user?.organizationId;
  const currentOrg = myOrganizations?.find((m) => m.organizationId === activeOrganizationId);
  // Multi-Organization Tenant Infrastructure: a caller with only one
  // legitimate membership never sees a switcher — there is nothing to
  // switch to, and showing one would imply the platform has other tenant
  // inventory to browse. A genuinely multi-org caller sees only their own
  // real memberships (myOrganizations is already self-scoped server-side).
  const hasMultipleOrganizations = (myOrganizations?.length ?? 0) > 1;
  const userInitials = user
    ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
    : '??';

  // Admin console access is a UX convenience gate only — every admin
  // endpoint independently enforces its own permission server-side
  // (requireMembership + requirePermission). This just avoids showing a
  // link to a page whose actions would all 403 for this user's roles.
  const isOrgAdmin = currentOrg?.roles.some((r) => r === 'org_admin' || r === 'super_admin') ?? false;
  // Same UX-convenience gate as isOrgAdmin — the leave_request.manage
  // permission (server-enforced) is what actually protects the balance
  // adjustment endpoint; this just avoids showing HR admins-only tooling to
  // a role that would 403 on every action.
  const isHrCapable = isOrgAdmin || (currentOrg?.roles.some((r) => r === 'hr_manager') ?? false);

  const handleSwitchOrganization = (organization: MembershipSummary) => {
    if (organization.organizationId === activeOrganizationId) return;
    switchOrganizationMutation.mutate(
      { data: { organizationId: organization.organizationId } },
      {
        onSuccess: () => {
          // organizationId is baked into every org-scoped query key, so once
          // getMe resolves to the new active org, those queries refetch
          // under new keys automatically — no manual cache clearing needed.
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListMyOrganizationsQueryKey() });
          toast({ title: `Switched to ${organization.organizationName}` });
        },
        onError: () => {
          toast({
            title: 'Could not switch organization',
            description: 'Please try again.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const navItems: NavItem[] = [
    { href: '/dashboard',      label: 'Dashboard',      icon: LayoutDashboard },
    { href: '/employees',      label: 'Employees',      icon: Users },
    { href: '/branches',       label: 'Branches',       icon: MapPin },
    { href: '/departments',    label: 'Departments',    icon: Network },
    { href: '/positions',      label: 'Positions',      icon: Briefcase },
    { href: '/self-service',   label: 'Employee Self-Service', icon: CalendarClock },
    // Phase 3G, W111 — unconditional nav visibility (frozen plan §25),
    // mirroring Leave Approvals' own precedent immediately below: manager
    // eligibility is a pure live reportingManagerId relationship, never a
    // role, so there is no role flag to gate this on. The page itself
    // resolves eligibility and renders the manager view, the HR/admin view,
    // or the "no direct reports" empty state — never a hidden nav entry.
    { href: '/manager',        label: 'Manager Portal', icon: Compass },
    { href: '/leave-approvals', label: 'Leave Approvals', icon: ClipboardCheck },
    { href: '/leave-calendar', label: 'Leave Calendar', icon: CalendarRange },
    { href: '/public-holidays', label: 'Public Holidays', icon: CalendarHeart },
    { href: '/leave-types',    label: 'Leave Types',    icon: CalendarDays },
    ...(isHrCapable ? [{ href: '/leave-balances', label: 'Leave Balances', icon: Wallet } satisfies NavItem] : []),
    ...(isOrgAdmin ? [{ href: '/attendance-settings', label: 'Attendance Settings', icon: Clock } satisfies NavItem] : []),
    // Phase 3B, W69 — nav entry is HR-capable-role-gated, same precedent as
    // every other Recruitment/Leave-management nav entry this platform
    // uses (see the isHrCapable entries around this one); the backend's
    // own/team tier still lets a manager reach the page directly by URL.
    ...(isHrCapable ? [{ href: '/attendance-register', label: 'Attendance Register', icon: ListChecks } satisfies NavItem] : []),
    // Phase 3B, W70 — same isHrCapable-only nav precedent as the Register
    // above; own/team tier is still reachable directly by URL for anyone
    // holding attendance.read.own, per attendanceReporting.ts's scope rules.
    ...(isHrCapable ? [{ href: '/attendance-dashboard', label: 'Attendance Dashboard', icon: LayoutDashboard } satisfies NavItem] : []),
    ...(isHrCapable ? [{ href: '/attendance-reports', label: 'Attendance Reports', icon: FileBarChart } satisfies NavItem] : []),
    // Phase 3C, W74 — same isHrCapable-only nav precedent as every other HR
    // configuration page (Leave Types, Attendance Settings, ...); the
    // backend's own "read broad" GET routes are still reachable directly by
    // URL for any performance.read.own holder, per performanceRatingScales.ts
    // / performanceReviewTemplates.ts's own route comments.
    ...(isHrCapable ? [{ href: '/performance-rating-scales', label: 'Performance Rating Scales', icon: Ruler } satisfies NavItem] : []),
    ...(isHrCapable ? [{ href: '/performance-templates', label: 'Performance Templates', icon: FileText } satisfies NavItem] : []),
    // Phase 3C, W75 — same isHrCapable-only precedent as W74's own two
    // Performance nav entries above; own/team tier is still reachable
    // directly by URL, though W75's own routes require performance.manage
    // uniformly (HR/admin configuration-and-assignment territory, unlike
    // W74's broader read grant — see routes/performanceCycles.ts).
    ...(isHrCapable ? [{ href: '/performance-cycles', label: 'Performance Cycles', icon: CalendarRange } satisfies NavItem] : []),
    // Phase 3C, W78 — §18's own frozen surface (/performance-team),
    // nav-gated isHrCapable-only per its own literal text (unchanged from
    // the draft) — same precedent as every other Performance nav entry
    // above. Backend authorization is reviewer-of-record via
    // reviewerEmployeeId regardless of nav visibility, so a manager who
    // isn't HR-capable is still correctly authorized if they navigate
    // directly; only the nav *entry* follows this convention.
    ...(isHrCapable ? [{ href: '/performance-team', label: 'My Team Reviews', icon: Users } satisfies NavItem] : []),
    // Phase 3C, W80 — §35's own frozen surface (/performance-reviews),
    // same isHrCapable-only nav precedent as every other Performance nav
    // entry above; backend remains performance.manage-gated regardless of
    // nav visibility.
    ...(isHrCapable ? [{ href: '/performance-reviews', label: 'Performance Reviews', icon: ClipboardCheck } satisfies NavItem] : []),
    // Phase 3C, W81 — §35's own frozen surfaces (/performance,
    // /performance-reports), same isHrCapable-only nav precedent as every
    // other Performance nav entry above; backend remains
    // performance.reports.read-gated (own/reviewer/org-wide scope) so a
    // non-HR reviewer who navigates directly is still correctly authorized.
    ...(isHrCapable ? [{ href: '/performance', label: 'Performance Dashboard', icon: LayoutDashboard } satisfies NavItem] : []),
    ...(isHrCapable ? [{ href: '/performance-reports', label: 'Performance Reports', icon: FileBarChart } satisfies NavItem] : []),
    // Phase 3D, W86 — same isHrCapable-only nav precedent as every other HR
    // configuration page above (Performance Rating Scales/Templates, ...);
    // the backend's own "read broad" GET routes are still reachable
    // directly by URL for any learning.read.own holder, per
    // learningCourses.ts's/learningCourseSessions.ts's own route comments.
    ...(isHrCapable ? [{ href: '/learning-courses', label: 'Learning Courses', icon: GraduationCap } satisfies NavItem] : []),
    // Phase 3D, W89 — same isHrCapable-only nav precedent as My Team
    // Reviews above (/performance-team): the backend's own manager-of-
    // record/instructor-of-record authorization is the real gate, so a
    // non-HR manager who navigates directly is still correctly authorized.
    ...(isHrCapable ? [{ href: '/learning-team-training', label: 'My Team Training', icon: Users } satisfies NavItem] : []),
    // Phase 3D, W91 — §15's own frozen internal HR/L&D workspace surface
    // (/learning-enrollments), same isHrCapable-only nav precedent as
    // /performance-reviews (W80): the backend's own org-wide routes remain
    // learning.manage-gated regardless of nav visibility.
    ...(isHrCapable ? [{ href: '/learning-enrollments', label: 'Learning Enrollments', icon: ClipboardList } satisfies NavItem] : []),
    // Phase 3D, W92 — §15's own frozen surfaces (/learning,
    // /learning-reports), same isHrCapable-only nav precedent as
    // /performance/​/performance-reports (W81); backend remains
    // learning.reports.read-gated (own/manager-of-record/org-wide scope) so
    // a non-HR manager who navigates directly is still correctly authorized.
    ...(isHrCapable ? [{ href: '/learning', label: 'Learning Dashboard', icon: LayoutDashboard } satisfies NavItem] : []),
    ...(isHrCapable ? [{ href: '/learning-reports', label: 'Learning Reports', icon: FileBarChart } satisfies NavItem] : []),
    // Phase 3E, W96 — §19's own frozen /assets register surface, same
    // isHrCapable-only nav precedent as every other HR configuration page
    // above; the backend's own asset_management.manage/.read.own gating is
    // the real authorization boundary regardless of nav visibility.
    ...(isHrCapable ? [{ href: '/assets', label: 'Asset Register', icon: Boxes } satisfies NavItem] : []),
    // Phase 3E, W98 — §19's own frozen manager "Team Assets" surface
    // (Decision 3), same isHrCapable-only nav precedent as
    // /learning-team-training (W89): the backend's own live
    // reportingManagerId relationship check is the real authorization
    // boundary, so a non-HR manager who navigates directly is still
    // correctly authorized and scoped.
    ...(isHrCapable ? [{ href: '/team-assets', label: 'Team Assets', icon: Users } satisfies NavItem] : []),
    // Phase 3E, W102 per the frozen plan's own §24 numbering — §19's own
    // frozen surfaces (/assets-dashboard, /asset-reports), same
    // isHrCapable-only nav precedent as /performance/​/performance-reports
    // (W81) and /learning/​/learning-reports (W92); backend remains
    // asset_management.reports.read-gated (own/manager-current-only/
    // org-wide scope) so a non-HR manager who navigates directly is still
    // correctly authorized and scoped.
    ...(isHrCapable ? [{ href: '/assets-dashboard', label: 'Asset Dashboard', icon: LayoutDashboard } satisfies NavItem] : []),
    ...(isHrCapable ? [{ href: '/asset-reports', label: 'Asset Reports', icon: FileBarChart } satisfies NavItem] : []),
    // Phase 3E, W101 — §19's own frozen org-wide operational surface
    // (/asset-workspace, asset_management.manage only), same isHrCapable-
    // only nav precedent as every other Assets/Performance/Learning
    // organization-wide page above; the backend's own .manage-gated
    // routes remain the real authorization boundary regardless of nav
    // visibility — a manager's own Team Assets relationship never widens
    // to this page.
    ...(isHrCapable ? [{ href: '/asset-workspace', label: 'Asset Workspace', icon: LayoutGrid } satisfies NavItem] : []),
    ...(isHrCapable ? [{ href: '/requisitions', label: 'Job Requisitions', icon: ClipboardList } satisfies NavItem] : []),
    ...(isHrCapable ? [{ href: '/requisition-approvals', label: 'Requisition Approvals', icon: Stamp } satisfies NavItem] : []),
    ...(isHrCapable ? [{ href: '/vacancies', label: 'Vacancies', icon: Megaphone } satisfies NavItem] : []),
    ...(isHrCapable ? [{ href: '/applications', label: 'Applications', icon: UserCheck } satisfies NavItem] : []),
    ...(isHrCapable ? [{ href: '/pipeline', label: 'Pipeline Board', icon: LayoutGrid } satisfies NavItem] : []),
    ...(isHrCapable ? [{ href: '/interviews', label: 'Interviews', icon: Video } satisfies NavItem] : []),
    ...(isHrCapable ? [{ href: '/talent-pools', label: 'Talent Pools', icon: Users2 } satisfies NavItem] : []),
    ...(isHrCapable ? [{ href: '/offers', label: 'Offers', icon: FileSignature } satisfies NavItem] : []),
    // Phase 3A, W61 — recruitment.reports.read is broadly seeded (assigned
    // recruiter/hiring-manager scope, per §7), but the nav link itself
    // follows the same isHrCapable-only precedent every other Recruitment
    // nav entry already uses (see /offers above) — an assigned employee can
    // still reach these pages directly by URL.
    ...(isHrCapable ? [{ href: '/recruitment', label: 'Recruitment Dashboard', icon: LayoutDashboard } satisfies NavItem] : []),
    ...(isHrCapable ? [{ href: '/recruitment-reports', label: 'Recruitment Reports', icon: FileBarChart } satisfies NavItem] : []),
    ...(isHrCapable ? [{ href: '/recruitment-settings', label: 'Recruitment Settings', icon: UserPlus } satisfies NavItem] : []),
    { href: '/organizations',  label: 'Organisations',  icon: Building },
    { href: '/notifications',  label: 'Notifications',  icon: Bell, badge: unreadCount },
    ...(isOrgAdmin ? [{ href: '/admin', label: 'Admin', icon: ShieldCheck } satisfies NavItem] : []),
    { href: '/settings',       label: 'Settings',       icon: Settings },
  ];

  if (userLoading) {
    return (
      <div
        className="flex h-screen w-full items-center justify-center bg-background"
        aria-label="Loading application"
        aria-busy="true"
      >
        <div className="flex flex-col items-center gap-3">
          <div
            className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary"
            role="status"
            aria-label="Loading"
          />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  // If there's no user and no loading, auth redirect is in progress — render nothing.
  if (!user) {
    return null;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside
        className="hidden lg:flex lg:flex-col lg:w-64 border-r border-sidebar-border bg-sidebar"
        aria-label="Main navigation"
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-6">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary"
            aria-hidden="true"
          >
            <Building2 className="h-6 w-6 text-primary-foreground" />
          </div>
          <span className="text-base font-semibold text-sidebar-foreground">
            Enterprise HRMS
          </span>
        </div>

        {/* Organisation selector */}
        {currentOrg &&
          (hasMultipleOrganizations ? (
            <OrgSwitcher
              currentOrg={currentOrg}
              organizations={myOrganizations ?? []}
              disabled={switchOrganizationMutation.isPending}
              onSwitch={handleSwitchOrganization}
            />
          ) : (
            <OrgLabel currentOrg={currentOrg} />
          ))}

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Primary">
          <NavLinks items={navItems} location={location} />
        </nav>

        {/* User profile */}
        <div className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-3 mb-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-primary text-primary-foreground font-medium">
                {userInitials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <Link
                href="/profile"
                className="block text-sm font-medium text-sidebar-foreground hover:underline truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                data-testid="link-profile"
                aria-label={`View profile for ${user.firstName} ${user.lastName}`}
              >
                {user.firstName} {user.lastName}
              </Link>
              <p className="text-xs text-muted-foreground truncate capitalize">
                {user.role.replace(/_/g, ' ')}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={handleLogout}
            disabled={logoutMutation.isPending}
            data-testid="button-logout"
            aria-label="Log out of your account"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Log out
          </Button>
        </div>
      </aside>

      {/* ── Mobile sidebar overlay ───────────────────────────────────────── */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/50 lg:hidden"
              aria-hidden="true"
              onClick={() => setSidebarOpen(false)}
            />

            {/* Drawer */}
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label="Navigation menu"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar lg:hidden"
            >
              <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary"
                    aria-hidden="true"
                  >
                    <Building2 className="h-6 w-6 text-primary-foreground" />
                  </div>
                  <span className="text-base font-semibold text-sidebar-foreground">
                    Enterprise HRMS
                  </span>
                </div>
                <Button
                  ref={closeButtonRef}
                  variant="ghost"
                  size="icon"
                  onClick={() => setSidebarOpen(false)}
                  data-testid="button-close-menu"
                  aria-label="Close navigation menu"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </Button>
              </div>

              {currentOrg &&
                (hasMultipleOrganizations ? (
                  <OrgSwitcher
                    currentOrg={currentOrg}
                    organizations={myOrganizations ?? []}
                    disabled={switchOrganizationMutation.isPending}
                    onSwitch={handleSwitchOrganization}
                  />
                ) : (
                  <OrgLabel currentOrg={currentOrg} />
                ))}

              <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Primary">
                <NavLinks
                  items={navItems}
                  location={location}
                  onNavigate={() => setSidebarOpen(false)}
                />
              </nav>

              <div className="border-t border-sidebar-border p-4">
                <div className="flex items-center gap-3 mb-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-primary text-primary-foreground font-medium">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <Link
                      href="/profile"
                      className="block text-sm font-medium text-sidebar-foreground hover:underline truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                      onClick={() => setSidebarOpen(false)}
                    >
                      {user.firstName} {user.lastName}
                    </Link>
                    <p className="text-xs text-muted-foreground truncate capitalize">
                      {user.role.replace(/_/g, ' ')}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={handleLogout}
                  disabled={logoutMutation.isPending}
                  aria-label="Log out of your account"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Log out
                </Button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <header
          className="flex h-16 items-center gap-4 border-b border-border bg-card px-4 lg:px-6"
          aria-label="Top navigation"
        >
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
            data-testid="button-open-menu"
            aria-label="Open navigation menu"
            aria-expanded={sidebarOpen}
            aria-controls="mobile-nav"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </Button>

          {/* Search */}
          <div className="flex-1 max-w-md">
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                placeholder="Search…"
                className="pl-9 bg-muted/50 border-muted"
                data-testid="input-search"
                aria-label="Search the application"
                // Search is UI-only in this shell release.
                readOnly
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Link href="/notifications" data-testid="button-notifications">
              <Button
                variant="ghost"
                size="icon"
                className="relative"
                aria-label={
                  unreadCount > 0
                    ? `Notifications — ${unreadCount} unread`
                    : 'Notifications'
                }
              >
                <Bell className="h-5 w-5" aria-hidden="true" />
                {unreadCount > 0 && (
                  <span
                    className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-accent"
                    aria-hidden="true"
                  />
                )}
              </Button>
            </Link>
            <Link href="/profile" data-testid="button-user-menu">
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Your profile — ${user.firstName} ${user.lastName}`}
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs font-medium">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </Link>
          </div>
        </header>

        {/* Page content */}
        <main id="main-content" className="flex-1 overflow-y-auto" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
