import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Building2,
  LayoutDashboard,
  Bell,
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
  Scale,
  DoorOpen,
  MessageSquareWarning,
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
  FolderOpen,
  GraduationCap,
  Boxes,
  Warehouse,
  Compass,
  Upload,
  DatabaseZap,
  SlidersHorizontal,
  UserRoundPlus,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
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
  useGetMyEmployee,
  getGetMyEmployeeQueryKey,
  useListNotifications,
  getListNotificationsQueryKey,
  useListMyOrganizations,
  getListMyOrganizationsQueryKey,
  useSwitchOrganization,
  getGetDashboardSummaryQueryKey,
  useLogout,
  type MembershipSummary,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { useMyProfilePhoto } from '@/hooks/use-employee-photo';
import { useIsOrgAdmin, useIsHrCapable } from '@/hooks/use-hr-capable';
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

interface NavGroupData {
  label: string;
  items: NavItem[];
}

function groupSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/**
 * WWM Presentation Readiness: the flat nav list grew to ~50 conditionally-
 * visible items as modules shipped over many workstreams — every item and
 * every permission/module condition here is unchanged from navItems below,
 * only regrouped into labelled, collapsible sections so the sidebar stays
 * navigable. A group with zero visible items (every item inside it filtered
 * out by the caller's own roles) renders nothing, including its header —
 * never an empty section. The section containing the current route starts
 * expanded; other sections start collapsed but remain independently
 * toggleable, and expanding one never collapses another.
 */
function NavGroupList({
  groups,
  location,
  onNavigate,
}: {
  groups: NavGroupData[];
  location: string;
  onNavigate?: () => void;
}) {
  const visibleGroups = groups.filter((g) => g.items.length > 0);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(visibleGroups.filter((g) => g.items.some((i) => i.href === location)).map((g) => g.label)),
  );

  useEffect(() => {
    const activeGroup = visibleGroups.find((g) => g.items.some((i) => i.href === location));
    if (activeGroup && !expanded.has(activeGroup.label)) {
      setExpanded((prev) => new Set(prev).add(activeGroup.label));
    }
    // Only ever grows the expanded set to include the active group — never
    // reacts to `expanded` itself, so a user's manual collapse is preserved
    // across unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, visibleGroups]);

  return (
    <div className="space-y-1">
      {visibleGroups.map((group) => {
        const isExpanded = expanded.has(group.label);
        return (
          <div key={group.label}>
            <button
              type="button"
              onClick={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(group.label)) next.delete(group.label);
                  else next.add(group.label);
                  return next;
                })
              }
              className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/60 transition-colors hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={isExpanded}
              data-testid={`button-nav-group-${groupSlug(group.label)}`}
            >
              <span>{group.label}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
                aria-hidden="true"
              />
            </button>
            {isExpanded && <NavLinks items={group.items} location={location} onNavigate={onNavigate} />}
          </div>
        );
      })}
    </div>
  );
}

function OrgLogo({ logoUrl, size = 'sm' }: { logoUrl: string | null | undefined; size?: 'sm' | 'lg' }) {
  const dimension = size === 'lg' ? 'h-9 w-9' : 'h-4 w-4';
  if (logoUrl) {
    return <img src={logoUrl} alt="" className={`${dimension} object-contain flex-shrink-0`} data-testid="img-org-logo" />;
  }
  return <Building className={`${dimension} text-muted-foreground flex-shrink-0`} aria-hidden="true" />;
}

// Consolidated sidebar brand header — logo, organization name, and (when
// the organization has configured one) its own system display name. This
// is the ONE branding block at the top of the sidebar: it replaces what
// used to be two stacked blocks (a hardcoded "Enterprise HRMS" header plus
// a separate organization pill below it). Every value is tenant-scoped
// (MembershipSummary), so a future organization that configures its own
// logo/systemDisplayName renders here identically — nothing WWM-specific
// is hardcoded.
function OrgBrandHeader({ currentOrg }: { currentOrg: MembershipSummary }) {
  return (
    <div className="flex items-center gap-3 border-b border-sidebar-border px-4 py-4" data-testid="text-org-current">
      <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white">
        <OrgLogo logoUrl={currentOrg.logoUrl} size="lg" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-sidebar-foreground">{currentOrg.organizationName}</p>
        {currentOrg.systemDisplayName && (
          <p className="truncate text-xs text-sidebar-foreground/70">{currentOrg.systemDisplayName}</p>
        )}
      </div>
    </div>
  );
}

function OrgBrandSwitcher({
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
    <div className="border-b border-sidebar-border px-4 py-4">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex w-full items-center gap-3 rounded-lg text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 -mx-1 px-1 py-1"
            aria-label={`Current organisation: ${currentOrg.organizationName}. Switch organisation`}
            disabled={disabled}
            data-testid="button-org-selector"
          >
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white">
              <OrgLogo logoUrl={currentOrg.logoUrl} size="lg" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-sidebar-foreground">{currentOrg.organizationName}</p>
              {currentOrg.systemDisplayName && (
                <p className="truncate text-xs text-sidebar-foreground/70">{currentOrg.systemDisplayName}</p>
              )}
            </div>
            <ChevronDown className="h-4 w-4 flex-shrink-0 text-sidebar-foreground/70" aria-hidden="true" />
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
              <OrgLogo logoUrl={org.logoUrl} />
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

  const { data: notifications } = useListNotifications(undefined, {
    query: { queryKey: getListNotificationsQueryKey() },
  });

  const { data: myOrganizations } = useListMyOrganizations({
    query: { queryKey: getListMyOrganizationsQueryKey() },
  });

  // Profile picture: a caller without a linked employee, or whose
  // organization has employee_self_service disabled, simply resolves to
  // "no picture" here — the fallback initials are always a safe default.
  const { data: myEmployeeResponse } = useGetMyEmployee({
    query: { queryKey: getGetMyEmployeeQueryKey(), enabled: !!user },
  });
  const myPhotoSrc = useMyProfilePhoto(myEmployeeResponse?.employee?.hasProfilePicture ?? false);

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
  // Shared with every other page's identical gate (hooks/use-hr-capable.ts)
  // rather than re-deriving the roles lookup here a second time.
  const isOrgAdmin = useIsOrgAdmin(activeOrganizationId ?? 0);
  const isHrCapable = useIsHrCapable(activeOrganizationId ?? 0);

  // WWM Organization Administrator verification (WWM Readiness W3): the
  // profile card previously showed `user.role` -- the legacy platform-wide
  // column, which is "employee" for every WWM presentation account
  // regardless of their real, membership_roles-granted authority (org_admin,
  // hr_manager, ...). An org_admin logging in and seeing their own sidebar
  // tell them they're an "Employee" is precisely the kind of thing that
  // makes an admin console hard to find -- the badge itself pointed away
  // from it. Prefers the caller's actual role(s) in their active
  // organization (same source isOrgAdmin/isHrCapable already read from);
  // falls back to the legacy field only if no membership is resolved yet.
  const roleLabel = (() => {
    const roles = currentOrg?.roles ?? [];
    if (roles.includes('super_admin')) return 'Super Admin';
    if (roles.includes('org_admin')) return 'Organization Administrator';
    if (roles.includes('hr_manager')) return 'HR Manager';
    if (roles.includes('employee')) return 'Employee';
    if (roles.length > 0) return roles[0].replace(/_/g, ' ');
    return user?.role.replace(/_/g, ' ') ?? '';
  })();

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
          // GET /dashboard/summary is the one exception: it takes no
          // parameters (resolves the caller's active org entirely from the
          // server-side session), so its query key never changes across an
          // org switch and needs an explicit invalidation like this one —
          // without it, a caller who switches organizations keeps seeing
          // the previous organization's dashboard figures until an
          // unrelated remount.
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
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

  // WWM Presentation Readiness: regrouped into labelled sections for
  // navigability (was one 50-item flat list) — every href/label/icon and
  // every isHrCapable/isOrgAdmin visibility condition below is unchanged
  // from before this pass, just re-bucketed. See NavGroupList for how an
  // empty group (every item filtered out) renders nothing.
  const navGroups: NavGroupData[] = [
    {
      label: 'Overview',
      items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }],
    },
    {
      label: 'Personnel',
      items: [
        { href: '/employees', label: 'Employees', icon: Users },
        // Phase 3H, W119 — Reporting & Legacy Import. Same isHrCapable-only
        // nav precedent as every other reports/import surface; the backend
        // remains personnel_file.read/personnel_file.manage+
        // employee_number.allocate-gated (never the broad employee.read),
        // so a non-HR caller who navigates directly is still correctly
        // authorized.
        ...(isHrCapable ? [{ href: '/personnel-reports', label: 'Personnel Reports', icon: FileBarChart } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/personnel-import', label: 'Legacy Import', icon: Upload } satisfies NavItem] : []),
        // WS-7 — the multi-entity migration engine, shown alongside (not
        // instead of) Legacy Import: that page still handles the simple
        // single-file employee case, this one handles a whole organization.
        // Same isHrCapable-only nav precedent; the backend remains
        // migration.*-gated, so a non-HR caller who navigates directly is
        // still correctly authorized.
        ...(isHrCapable ? [{ href: '/data-migration', label: 'Data Migration', icon: DatabaseZap } satisfies NavItem] : []),
        // WS-8 — organization configuration surfaces. Same isHrCapable-only
        // nav precedent; the backend remains custom_fields.*/custom_forms.*
        // gated, so a non-HR caller navigating directly is still authorized
        // correctly.
        ...(isHrCapable ? [{ href: '/custom-fields', label: 'Custom Fields', icon: SlidersHorizontal } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/custom-forms', label: 'Form Builder', icon: ClipboardList } satisfies NavItem] : []),
        // WS-9 — the authorized manual capture path and the recruitment
        // approval configuration surface. Same isHrCapable-only nav
        // precedent; both remain permission-gated server-side.
        ...(isHrCapable ? [{ href: '/add-candidate', label: 'Add Candidate', icon: UserRoundPlus } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/recruitment-approvals-config', label: 'Recruitment Approvals', icon: ShieldCheck } satisfies NavItem] : []),
        // WS-10. HR-capable only for the organization-wide view; every employee
        // reaches their own onboarding through Self-Service instead. Both remain
        // permission-gated and module-gated server-side.
        ...(isHrCapable ? [{ href: '/onboarding', label: 'Onboarding', icon: ClipboardCheck } satisfies NavItem] : []),
        // WS-12 — Employee Relations and Offboarding follow the same
        // `isHrCapable` nav precedent as Onboarding above. Nav visibility is
        // presentation only: each page independently discovers what the caller
        // may actually see, and every endpoint enforces its own permission
        // server-side. The grievance tab in particular renders only if the
        // grievance endpoint answers, since §28.17 withholds that key from
        // organization administration by default.
        ...(isHrCapable ? [{ href: '/employee-relations', label: 'Employee Relations', icon: Scale } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/offboarding', label: 'Offboarding', icon: DoorOpen } satisfies NavItem] : []),
        { href: '/branches', label: 'Branches', icon: MapPin },
        { href: '/departments', label: 'Departments', icon: Network },
        { href: '/positions', label: 'Positions', icon: Briefcase },
        // WS-5 — Documents & Records Foundation. Same isHrCapable-only nav
        // precedent as the other records surfaces above; the backend remains
        // organization_document.*/document_template.*-gated, so a non-HR
        // caller who navigates directly is still correctly authorized. Not
        // module-gated: WS-5 is foundation, not an optional module.
        ...(isHrCapable ? [{ href: '/documents', label: 'Documents & Records', icon: FolderOpen } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/document-templates', label: 'Document Templates', icon: FileSignature } satisfies NavItem] : []),
      ],
    },
    {
      label: 'Self-Service',
      items: [
        { href: '/self-service', label: 'Employee Self-Service', icon: CalendarClock },
        // WS-10 — every employee reaches their OWN onboarding here. Unconditional
        // for the same reason the Manager Portal is: the page resolves the
        // caller's own employee record server-side and renders an empty state
        // when there is nothing to show, rather than hiding a nav entry.
        { href: '/my-onboarding', label: 'My Onboarding', icon: ClipboardCheck },
        // WS-12 (§28.5) — every employee reaches their OWN grievances here,
        // unconditionally, for the same reason as My Onboarding above: the page
        // resolves the caller's own employee record server-side and renders an
        // empty state when there is nothing to show. Gating it on a permission
        // would be wrong twice over — no permission key exists for self-service
        // grievances, and hiding the entry would make raising one harder for
        // exactly the people it exists to serve.
        { href: '/my-grievances', label: 'My Grievances', icon: MessageSquareWarning },
        // Phase 3G, W111 — unconditional nav visibility (frozen plan §25):
        // manager eligibility is a pure live reportingManagerId
        // relationship, never a role, so there is no role flag to gate this
        // on. The page itself resolves eligibility and renders the manager
        // view, the HR/admin view, or the "no direct reports" empty state
        // — never a hidden nav entry.
        { href: '/manager', label: 'Manager Portal', icon: Compass },
      ],
    },
    {
      label: 'Attendance',
      items: [
        // Phase 3B, W69/W70 — nav entries are HR-capable-role-gated, same
        // precedent as every other Recruitment/Leave-management nav entry
        // this platform uses; the backend's own/team tier still lets a
        // manager reach these pages directly by URL.
        ...(isHrCapable ? [{ href: '/attendance-register', label: 'Attendance Register', icon: ListChecks } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/attendance-dashboard', label: 'Attendance Dashboard', icon: LayoutDashboard } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/attendance-reports', label: 'Attendance Reports', icon: FileBarChart } satisfies NavItem] : []),
        ...(isOrgAdmin ? [{ href: '/attendance-settings', label: 'Attendance Settings', icon: Clock } satisfies NavItem] : []),
      ],
    },
    {
      label: 'Leave Management',
      items: [
        { href: '/leave-approvals', label: 'Leave Approvals', icon: ClipboardCheck },
        { href: '/leave-calendar', label: 'Leave Calendar', icon: CalendarRange },
        { href: '/public-holidays', label: 'Public Holidays', icon: CalendarHeart },
        { href: '/leave-types', label: 'Leave Types', icon: CalendarDays },
        ...(isHrCapable ? [{ href: '/leave-balances', label: 'Leave Balances', icon: Wallet } satisfies NavItem] : []),
      ],
    },
    {
      label: 'Performance',
      items: [
        // Phase 3C, W74/W75/W78/W80/W81 — same isHrCapable-only nav
        // precedent throughout; each backend route keeps its own broader
        // own/team/reviewer-of-record authorization regardless of nav
        // visibility (see performanceRatingScales.ts, performanceCycles.ts,
        // performanceReviews.ts's own route comments).
        ...(isHrCapable ? [{ href: '/performance', label: 'Performance Dashboard', icon: LayoutDashboard } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/performance-reviews', label: 'Performance Reviews', icon: ClipboardCheck } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/performance-team', label: 'My Team Reviews', icon: Users } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/performance-cycles', label: 'Performance Cycles', icon: CalendarRange } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/performance-templates', label: 'Performance Templates', icon: FileText } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/performance-rating-scales', label: 'Performance Rating Scales', icon: Ruler } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/performance-reports', label: 'Performance Reports', icon: FileBarChart } satisfies NavItem] : []),
      ],
    },
    {
      label: 'Learning & Development',
      items: [
        // Phase 3D, W86/W89/W91/W92 — same isHrCapable-only nav precedent
        // throughout; each backend route's own manager-of-record/
        // instructor-of-record/org-wide authorization remains the real
        // gate regardless of nav visibility.
        ...(isHrCapable ? [{ href: '/learning', label: 'Learning Dashboard', icon: LayoutDashboard } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/learning-courses', label: 'Learning Courses', icon: GraduationCap } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/learning-team-training', label: 'My Team Training', icon: Users } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/learning-enrollments', label: 'Learning Enrollments', icon: ClipboardList } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/learning-reports', label: 'Learning Reports', icon: FileBarChart } satisfies NavItem] : []),
      ],
    },
    {
      label: 'Assets',
      items: [
        // Phase 3E, W96/W98/W101/W102 — same isHrCapable-only nav precedent
        // throughout; each backend route's own asset_management.manage/
        // .read.own/reportingManagerId gating remains the real
        // authorization boundary regardless of nav visibility.
        ...(isHrCapable ? [{ href: '/assets-dashboard', label: 'Asset Dashboard', icon: LayoutDashboard } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/assets', label: 'Asset Register', icon: Boxes } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/team-assets', label: 'Team Assets', icon: Users } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/asset-workspace', label: 'Asset Workspace', icon: LayoutGrid } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/asset-reports', label: 'Asset Reports', icon: FileBarChart } satisfies NavItem] : []),
      ],
    },
    {
      label: 'Office Inventory',
      items: [
        // Office Inventory, Workstream 1 — module is registered "hidden" by
        // default (WWM's own organization_modules override enables it) and
        // this nav entry is isHrCapable-gated like every other HR
        // configuration page above; the real authorization boundary is
        // /office-inventory's own requireModuleEnabled("office_inventory")
        // + office_inventory.*.manage gating on the backend, so nav
        // visibility alone never grants access — for a disabled org the
        // ModuleGate wrapping this route shows its own "module not
        // enabled" state rather than the page underneath.
        ...(isHrCapable ? [{ href: '/office-inventory', label: 'Office Inventory', icon: Warehouse } satisfies NavItem] : []),
      ],
    },
    {
      label: 'Recruitment',
      items: [
        ...(isHrCapable ? [{ href: '/recruitment', label: 'Recruitment Dashboard', icon: LayoutDashboard } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/requisitions', label: 'Job Requisitions', icon: ClipboardList } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/requisition-approvals', label: 'Requisition Approvals', icon: Stamp } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/vacancies', label: 'Vacancies', icon: Megaphone } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/applications', label: 'Applications', icon: UserCheck } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/pipeline', label: 'Pipeline Board', icon: LayoutGrid } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/interviews', label: 'Interviews', icon: Video } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/talent-pools', label: 'Talent Pools', icon: Users2 } satisfies NavItem] : []),
        // Phase 3A, W61 — recruitment.reports.read is broadly seeded
        // (assigned recruiter/hiring-manager scope, per §7), but the nav
        // link itself follows the same isHrCapable-only precedent every
        // other Recruitment nav entry already uses — an assigned employee
        // can still reach these pages directly by URL.
        ...(isHrCapable ? [{ href: '/offers', label: 'Offers', icon: FileSignature } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/recruitment-reports', label: 'Recruitment Reports', icon: FileBarChart } satisfies NavItem] : []),
        ...(isHrCapable ? [{ href: '/recruitment-settings', label: 'Recruitment Settings', icon: UserPlus } satisfies NavItem] : []),
      ],
    },
    {
      // WWM Organization Administrator verification (WWM Readiness W3):
      // "Admin" sitting next to a permanently non-functional "Settings"
      // stub ("Coming Soon", no permission gate, does nothing for any
      // organization) was the actual reason an org_admin couldn't tell
      // where to manage their organization -- the one real console was
      // genericly labelled and easy to mistake for the decorative one
      // beside it. Same href/isOrgAdmin condition as before, just a
      // clearer label and the dead stub removed from nav (route still
      // exists for direct-URL access; nothing here changes what any role
      // is authorized to do server-side).
      label: 'Administration',
      items: [
        { href: '/organizations', label: 'Organisations', icon: Building },
        ...(isOrgAdmin
          ? [{ href: '/admin', label: 'Organization Administration', icon: ShieldCheck } satisfies NavItem]
          : []),
      ],
    },
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
        {/* Brand header — organization logo/name/system name, or a generic
            platform fallback for the brief window before currentOrg loads. */}
        {currentOrg ? (
          hasMultipleOrganizations ? (
            <OrgBrandSwitcher
              currentOrg={currentOrg}
              organizations={myOrganizations ?? []}
              disabled={switchOrganizationMutation.isPending}
              onSwitch={handleSwitchOrganization}
            />
          ) : (
            <OrgBrandHeader currentOrg={currentOrg} />
          )
        ) : (
          <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary" aria-hidden="true">
              <Building2 className="h-6 w-6 text-primary-foreground" />
            </div>
            <span className="text-base font-semibold text-sidebar-foreground">Enterprise HRMS</span>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Primary">
          <NavGroupList groups={navGroups} location={location} />
        </nav>

        {/* User profile */}
        <div className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-3 mb-3">
            <Avatar className="h-10 w-10">
              {myPhotoSrc && <AvatarImage src={myPhotoSrc} alt="" />}
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
                {roleLabel}
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
              <div className="flex items-center justify-end border-b border-sidebar-border px-2 py-2">
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

              {currentOrg ? (
                hasMultipleOrganizations ? (
                  <OrgBrandSwitcher
                    currentOrg={currentOrg}
                    organizations={myOrganizations ?? []}
                    disabled={switchOrganizationMutation.isPending}
                    onSwitch={handleSwitchOrganization}
                  />
                ) : (
                  <OrgBrandHeader currentOrg={currentOrg} />
                )
              ) : (
                <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary" aria-hidden="true">
                    <Building2 className="h-6 w-6 text-primary-foreground" />
                  </div>
                  <span className="text-base font-semibold text-sidebar-foreground">Enterprise HRMS</span>
                </div>
              )}

              <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Primary">
                <NavGroupList
                  groups={navGroups}
                  location={location}
                  onNavigate={() => setSidebarOpen(false)}
                />
              </nav>

              <div className="border-t border-sidebar-border p-4">
                <div className="flex items-center gap-3 mb-3">
                  <Avatar className="h-10 w-10">
                    {myPhotoSrc && <AvatarImage src={myPhotoSrc} alt="" />}
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
                      {roleLabel}
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

          {/* No global search control here: there is no real cross-module
              search capability to back it, and a search box that visually
              accepts input but does nothing is exactly the kind of
              decorative-but-non-functional control this shell avoids. */}
          <div className="flex-1" />

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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Account menu — ${user.firstName} ${user.lastName}`}
                  data-testid="button-user-menu"
                >
                  <Avatar className="h-8 w-8">
                    {myPhotoSrc && <AvatarImage src={myPhotoSrc} alt="" />}
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs font-medium">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <p className="text-sm font-medium text-foreground truncate">
                    {user.firstName} {user.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild data-testid="link-profile">
                  <Link href="/profile" className="cursor-pointer">
                    Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={handleLogout}
                  disabled={logoutMutation.isPending}
                  data-testid="button-header-logout"
                  className="cursor-pointer"
                >
                  <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
