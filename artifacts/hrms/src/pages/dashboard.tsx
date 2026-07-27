import { Link } from 'wouter';
import { Users, Package, Clock, Bell } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useGetDashboardSummary, getGetDashboardSummaryQueryKey, useGetMe, getGetMeQueryKey } from '@workspace/api-client-react';
import { motion } from 'framer-motion';

export default function Dashboard() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const { data: summary, isLoading } = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() } });

  const modules = [
    {
      title: 'Employee Records',
      description: 'Manage comprehensive employee profiles, documents, and organizational structure',
      href: '/employees',
      status: 'available' as const,
    },
    {
      title: 'Branches',
      description: "Manage your organisation's physical or regional locations",
      href: '/branches',
      status: 'available' as const,
    },
    {
      title: 'Departments',
      description: 'Organise employees into functional or organisational units',
      href: '/departments',
      status: 'available' as const,
    },
    {
      title: 'Positions',
      description: 'Define job titles employees can be assigned to',
      href: '/positions',
      status: 'available' as const,
    },
    {
      title: 'Leave & Attendance',
      description: 'Track time off requests, monitor attendance, and manage shift schedules',
      status: 'coming-soon' as const
    },
    {
      title: 'Performance Management',
      description: 'Set goals, conduct reviews, and track employee development',
      status: 'coming-soon' as const
    },
    {
      title: 'Recruitment',
      description: 'Post jobs, track candidates, and streamline the hiring process',
      status: 'coming-soon' as const
    },
    {
      title: 'Training & Development',
      description: 'Organize training programs, certifications, and skill development',
      status: 'coming-soon' as const
    },
    {
      title: 'Document Management',
      description: 'Centralized document storage with version control and access management',
      status: 'coming-soon' as const
    }
  ];

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
      title: 'Pending Requests',
      value: summary?.pendingRequests ?? 0,
      icon: Clock,
      color: 'text-chart-3'
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
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
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
          {modules.map((module, i) => {
            const isAvailable = module.status === 'available';
            const card = (
              <Card
                className={`h-full transition-shadow ${isAvailable ? 'hover:shadow-md hover:border-primary/50' : ''}`}
                data-testid={`card-module-${module.title.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg">{module.title}</CardTitle>
                    <Badge variant={isAvailable ? 'default' : 'secondary'} className="text-xs">
                      {isAvailable ? 'Available' : 'Coming Soon'}
                    </Badge>
                  </div>
                  <CardDescription className="text-sm leading-relaxed">
                    {module.description}
                  </CardDescription>
                </CardHeader>
              </Card>
            );
            return (
              <motion.div
                key={module.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + i * 0.05 }}
              >
                {isAvailable && module.href ? (
                  <Link href={module.href} data-testid={`link-module-${module.title.toLowerCase().replace(/\s+/g, '-')}`}>
                    {card}
                  </Link>
                ) : (
                  card
                )}
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
            directory are live. Leave, performance, recruitment, training, and document management
            are still under development.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
