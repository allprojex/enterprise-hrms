import { Link } from 'wouter';
import { Users, Package, Bell } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useGetDashboardSummary,
  getGetDashboardSummaryQueryKey,
  useGetMe,
  getGetMeQueryKey,
  useListModules,
  getListModulesQueryKey,
} from '@workspace/api-client-react';
import { motion } from 'framer-motion';

// Core Platform / HR Foundation capabilities — always available to every
// organization, per ARCHITECTURE.md. Not part of the Module Registry (W3),
// since they aren't togglable feature modules; the registry-driven,
// per-organization-configurable modules are fetched below.
const FOUNDATION_CAPABILITIES = [
  {
    title: 'Employee Records',
    description: 'Manage comprehensive employee profiles, documents, and organizational structure',
    href: '/employees',
  },
  {
    title: 'Branches',
    description: "Manage your organisation's physical or regional locations",
    href: '/branches',
  },
  {
    title: 'Departments',
    description: 'Organise employees into functional or organisational units',
    href: '/departments',
  },
  {
    title: 'Positions',
    description: 'Define job titles employees can be assigned to',
    href: '/positions',
  },
];

export default function Dashboard() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const { data: summary, isLoading } = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() } });
  const { data: modules } = useListModules({ query: { queryKey: getListModulesQueryKey() } });

  const stats = [
    {
      title: 'Total Employees',
      value: summary?.totalEmployees ?? 0,
      icon: Users,
      color: 'text-primary'
    },
    {
      title: 'Active Modules',
      value: summary?.activeModules ?? 0,
      icon: Package,
      color: 'text-accent'
    },
    {
      title: 'Unread Notifications',
      value: summary?.unreadNotifications ?? 0,
      icon: Bell,
      color: 'text-chart-5'
    }
  ];

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground">
          Welcome back, {user?.firstName}
        </h1>
        <p className="text-muted-foreground">
          Here's an overview of your HR system
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <Card data-testid={`card-stat-${stat.title.toLowerCase().replace(/\s+/g, '-')}`}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <div className="text-3xl font-bold text-foreground">{stat.value}</div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Modules Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Available Modules</h2>
            <p className="text-muted-foreground">Organisation and workforce management modules</p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FOUNDATION_CAPABILITIES.map((capability, i) => (
            <motion.div
              key={capability.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.05 }}
            >
              <Link
                href={capability.href}
                data-testid={`link-module-${capability.title.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <Card
                  className="h-full transition-shadow hover:shadow-md hover:border-primary/50"
                  data-testid={`card-module-${capability.title.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-lg">{capability.title}</CardTitle>
                      <Badge variant="default" className="text-xs">Available</Badge>
                    </div>
                    <CardDescription className="text-sm leading-relaxed">
                      {capability.description}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </motion.div>
          ))}
          {(modules ?? []).map((module, i) => {
            const isAvailable = module.status === 'active' || module.status === 'beta';
            return (
              <motion.div
                key={module.key}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + (FOUNDATION_CAPABILITIES.length + i) * 0.05 }}
              >
                <Card
                  className="h-full"
                  data-testid={`card-module-${module.key.replace(/_/g, '-')}`}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-lg">{module.name}</CardTitle>
                      <Badge variant={isAvailable ? 'default' : 'secondary'} className="text-xs">
                        {isAvailable ? 'Available' : 'Coming Soon'}
                      </Badge>
                    </div>
                    <CardDescription className="text-sm leading-relaxed">
                      {module.description}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Info Banner */}
      <Card className="bg-muted/30 border-muted">
        <CardHeader>
          <CardTitle className="text-base">System Status</CardTitle>
          <CardDescription>
            Authentication, organisation management, and the employee/branch/department/position
            directory are live.
            {(modules ?? []).some((m) => m.status !== 'active' && m.status !== 'beta') && (
              <> {(modules ?? []).filter((m) => m.status !== 'active' && m.status !== 'beta').length} additional module(s) are still under development.</>
            )}
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
