import { Users, Boxes } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  useGetMe,
  getGetMeQueryKey,
  useListTeamAssetAssignments,
  getListTeamAssetAssignmentsQueryKey,
  useListEmployees,
  getListEmployeesQueryKey,
} from '@workspace/api-client-react';
import { QueryError } from '@/components/query-error';

// Team Assets (Phase 3E, W98, Decision 3): current custody for the caller's
// current direct reports only — mirroring /learning-team-training's own
// established manager-surface shape (isHrCapable-only nav gating, backend
// remaining the real authorization gate regardless of nav visibility). This
// page is READ-ONLY by construction — no assign/return/condition/mark-lost/
// recover/retire/acknowledge/incident-review control exists anywhere here
// (Decision 4: no manager mutation authority). No historical custody is
// ever shown — the backend's own GET .../assets/team-assets route only
// ever returns currently-open assignment rows.
export default function TeamAssets() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const teamQuery = useListTeamAssetAssignments(organizationId, {
    query: { queryKey: getListTeamAssetAssignmentsQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const { data: employeesPage } = useListEmployees(organizationId, { pageSize: 200 }, {
    query: { queryKey: getListEmployeesQueryKey(organizationId, { pageSize: 200 }), enabled: organizationId > 0 },
  });
  const employeeById = new Map((employeesPage?.items ?? []).map((e) => [e.id, e]));

  const assignments = teamQuery.data ?? [];

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <Users className="h-7 w-7 text-primary" aria-hidden="true" />
          Team Assets
        </h1>
        <p className="text-muted-foreground">
          Assets currently held by your direct reports. Read-only — assignment, return, and condition changes are managed through the Asset Register.
        </p>
      </div>

      {teamQuery.isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading team assets">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : teamQuery.error ? (
        <QueryError title="Could not load your team's assets" message="Could not fetch current custody for your direct reports. Try again." onRetry={() => teamQuery.refetch()} />
      ) : assignments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <Boxes className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No current custody to show</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              None of your current direct reports currently hold any assets.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table aria-label="Team assets">
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Asset</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Acknowledgement</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((a) => {
                const emp = employeeById.get(a.employeeId);
                return (
                  <TableRow key={a.id} data-testid={`row-team-asset-${a.id}`}>
                    <TableCell className="font-medium">{emp ? `${emp.firstName} ${emp.lastName}` : `Employee #${a.employeeId}`}</TableCell>
                    <TableCell>{a.assetNameSnapshot}</TableCell>
                    <TableCell className="text-muted-foreground">{a.categorySnapshot}</TableCell>
                    <TableCell className="text-muted-foreground">{new Date(a.issuedAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Badge variant={a.acknowledgedAt ? 'secondary' : 'outline'} data-testid={`badge-team-ack-status-${a.id}`}>
                        {a.acknowledgedAt ? 'Acknowledged' : 'Not Yet Acknowledged'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
