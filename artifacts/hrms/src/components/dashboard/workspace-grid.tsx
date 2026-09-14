import * as React from 'react';
import { Link } from 'wouter';
import {
  Users,
  FolderLock,
  CalendarDays,
  Clock,
  TrendingUp,
  GraduationCap,
  Briefcase,
  Laptop,
  Boxes,
  FileText,
  BarChart3,
  UserCircle,
  Building2,
  Network,
  BadgeCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { SectionHeader } from '@/components/foundation';
import type { WorkspaceCard, WorkspaceKey } from '@/lib/hr-dashboard';

const ICONS: Record<WorkspaceKey, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  employees: Users,
  personnel_files: FolderLock,
  leave: CalendarDays,
  attendance: Clock,
  performance: TrendingUp,
  learning: GraduationCap,
  recruitment: Briefcase,
  assets: Laptop,
  office_inventory: Boxes,
  forms: FileText,
  reports: BarChart3,
  self_service: UserCircle,
  branches: Building2,
  departments: Network,
  positions: BadgeCheck,
};

/** Quick Access — compact entry points, only for destinations the caller can open. */
export function WorkspaceGrid({ cards }: { cards: WorkspaceCard[] }) {
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby="workspace-heading" className="space-y-3" data-testid="section-workspace">
      <SectionHeader title={<span id="workspace-heading">Quick Access</span>} description="Your HR workspace" />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = ICONS[card.key];
          return (
            <li key={card.key}>
              <Link
                href={card.href}
                className="group flex h-full min-h-[4.5rem] items-center gap-3 rounded-lg border border-border bg-surface p-3 transition-colors hover:border-border-strong hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                data-testid={`workspace-card-${card.key}`}
              >
                <span className="grid size-9 shrink-0 place-content-center rounded-md bg-primary-soft text-primary-soft-foreground">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm font-semibold text-foreground">{card.title}</span>
                  <span className="block truncate text-helper text-foreground-muted">{card.description}</span>
                </span>
                <Badge variant={card.badge.tone} className="shrink-0 text-xs" data-testid={`workspace-badge-${card.key}`}>
                  {card.badge.text}
                </Badge>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
