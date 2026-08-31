/**
 * WS-17 Slice 1 — Fleet Health for platform operators.
 *
 * TWO PRESENTATION RULES, BOTH DELIBERATE:
 *
 *  1. NO COMPOSITE SCORE. There is no "82% healthy" anywhere, because the
 *     platform does not yet have enough authoritative signals to justify that
 *     precision — a weighted number would hide which of six things is wrong
 *     behind arithmetic that looks authoritative.
 *  2. STATE IS NEVER CARRIED BY COLOUR ALONE. Every state renders a word AND a
 *     reason ("Telemetry has not been received"), because an operator deciding
 *     whether to wake someone at 3am needs to know *what* is wrong, and because
 *     colour alone excludes anyone who cannot distinguish these hues.
 *
 * `unknown` and `stale` are shown as themselves — never rounded up to healthy
 * and never rendered as failure. An installation nobody can observe is honestly
 * unobserved.
 */
import { useMemo, useState } from 'react';
import { Server, ShieldQuestion, Building2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { useGetFleetHealth, useListInstallationDeployments, useListInstallationBackupRuns } from '@workspace/api-client-react';

type HealthState = 'healthy' | 'degraded' | 'unhealthy' | 'unknown' | 'stale';

/**
 * Each state gets a distinct WORD, a distinct badge treatment and — for the
 * non-healthy ones — an explanatory sentence beside it. The word is the
 * primary signal; colour only reinforces it.
 */
const STATE_LABEL: Record<HealthState, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  unhealthy: 'Unhealthy',
  unknown: 'Unknown',
  stale: 'Stale',
};

const STATE_VARIANT: Record<HealthState, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  healthy: 'default',
  degraded: 'secondary',
  unhealthy: 'destructive',
  unknown: 'outline',
  stale: 'outline',
};

function StateBadge({ state }: { state: HealthState }) {
  return (
    <Badge variant={STATE_VARIANT[state]} className="whitespace-nowrap">
      {STATE_LABEL[state]}
    </Badge>
  );
}

function InstallationDetail({ installationId }: { installationId: number }) {
  const deployments = useListInstallationDeployments(installationId);
  const runs = useListInstallationBackupRuns(installationId);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <h4 className="mb-2 text-sm font-medium">Deployment history</h4>
        {deployments.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : !deployments.data?.deployments?.length ? (
          <p className="text-sm text-muted-foreground">No deployment has been recorded.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deployments.data.deployments.slice(0, 5).map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">{d.applicationVersion ?? '—'}</TableCell>
                  <TableCell>{d.result}</TableCell>
                  <TableCell className="text-muted-foreground">{d.executorType}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-sm font-medium">Backup evidence</h4>
        {runs.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : !runs.data?.runs?.length ? (
          <p className="text-sm text-muted-foreground">No backup evidence has been received.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Result</TableHead>
                <TableHead>Database</TableHead>
                <TableHead>Binaries</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.data.runs.slice(0, 5).map((r) => (
                <TableRow key={r.id}>
                  {/* `partial` is shown as itself: a database-only backup is
                      never displayed as a complete one. */}
                  <TableCell>{r.result}</TableCell>
                  <TableCell className="text-muted-foreground">{r.databaseResult}</TableCell>
                  <TableCell className="text-muted-foreground">{r.binaryStorageResult}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

export function FleetHealth() {
  const fleet = useGetFleetHealth();
  const [expanded, setExpanded] = useState<number | null>(null);

  const installations = useMemo(() => fleet.data?.installations ?? [], [fleet.data]);

  if (fleet.isLoading) return <Skeleton className="h-48 w-full" />;

  if (fleet.isError) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldQuestion className="h-5 w-5" aria-hidden />
          Fleet health requires the platform fleet-read authority. Being a super admin is not sufficient on its own.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5" aria-hidden />
          Fleet health
        </CardTitle>
        <CardDescription>
          Signals derived from recorded evidence. An installation that has reported nothing shows as Unknown — never as
          healthy — and there is deliberately no overall score.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {installations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No installations are registered.</p>
        ) : (
          installations.map((inst) => {
            const state = inst.overall as HealthState;
            const isOpen = expanded === inst.installationId;
            return (
              <div key={inst.installationId} className="rounded-lg border p-4">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : inst.installationId)}
                  aria-expanded={isOpen}
                  className="flex w-full flex-wrap items-center justify-between gap-3 text-left"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{inst.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {inst.environmentType} · {inst.hostingModel}
                    </span>
                  </span>
                  <StateBadge state={state} />
                </button>

                <ul className="mt-3 space-y-1">
                  {inst.signals.map((signal) => (
                    <li key={signal.key} className="flex flex-wrap items-center gap-2 text-sm">
                      <StateBadge state={signal.state as HealthState} />
                      {/* The reason, always — state is never colour alone. */}
                      <span className="text-muted-foreground">{signal.detail}</span>
                    </li>
                  ))}
                </ul>

                {inst.affectedOrganizations.length > 0 && (
                  <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5" aria-hidden />
                    {/* One installation, many tenants — derived, never duplicated. */}
                    Affects {inst.affectedOrganizations.length} organization
                    {inst.affectedOrganizations.length === 1 ? '' : 's'}:{' '}
                    {inst.affectedOrganizations.map((o) => o.name).join(', ')}
                  </p>
                )}

                {isOpen && (
                  <div className="mt-4 border-t pt-4">
                    <InstallationDetail installationId={inst.installationId} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
