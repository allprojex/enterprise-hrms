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
  const userInitials = user
    ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
    : '??';

  // Admin console access is a UX convenience gate only — every admin
  // endpoint independently enforces its own permission server-side
  // (requireMembership + requirePermission). This just avoids showing a
  // link to a page whose actions would all 403 for this user's roles.
  const isOrgAdmin = currentOrg?.roles.some((r) => r === 'org_admin' || r === 'super_admin') ?? false;

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
    { href: '/leave-types',    label: 'Leave Types',    icon: CalendarDays },
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
        {currentOrg && (
          <OrgSwitcher
            currentOrg={currentOrg}
            organizations={myOrganizations ?? []}
            disabled={switchOrganizationMutation.isPending}
            onSwitch={handleSwitchOrganization}
          />
        )}

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

              {currentOrg && (
                <OrgSwitcher
                  currentOrg={currentOrg}
                  organizations={myOrganizations ?? []}
                  disabled={switchOrganizationMutation.isPending}
                  onSwitch={handleSwitchOrganization}
                />
              )}

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
