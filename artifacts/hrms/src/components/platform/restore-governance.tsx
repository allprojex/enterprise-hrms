/**
 * WS-17 Restore Governance — the Super Admin surface.
 *
 * THIS SCREEN EXISTS TO MAKE A BLIND APPROVAL IMPOSSIBLE.
 *
 * A physical restore of a shared installation rolls back every customer on it.
 * So an approver is shown, before they can decide: which installation, whether
 * it is production, which recovery point, whether that point actually covers
 * the files as well as the database, which risks were accepted and by whom,
 * exactly which organizations are affected, and whether anything has drifted
 * since the request. There is no one-click approve.
 *
 * Two presentation rules, as elsewhere in this control plane:
 *
 *  - **State never depends on colour alone.** Every status renders a word, and
 *    risky ones render an explanatory sentence. An operator deciding whether to
 *    roll back production at 3am must be able to read what is wrong.
 *  - **Nothing is dressed up.** A partial recovery point says "partial" and
 *    names the missing component; it is never softened into a warning badge on
 *    an otherwise-green row.
 */
import { useState } from 'react';
import { History, ShieldAlert, AlertTriangle, Building2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { useListRestoreRequests, useGetRestoreRequestDetail } from '@workspace/api-client-react';

const STATUS_LABEL: Record<string, string> = {
  submitted: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
  dispatched: 'Dispatched',
  executing: 'Executing',
  succeeded: 'Executed — not yet validated',
  failed: 'Execution failed',
  validated: 'Validated',
  validation_failed: 'Validation failed',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

/** Deliberately explicit: `succeeded` is not success from a governance view. */
function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'validated') return 'default';
  if (status === 'failed' || status === 'validation_failed' || status === 'rejected') return 'destructive';
  if (status === 'submitted' || status === 'approved') return 'outline';
  return 'secondary';
}

const COMPLETENESS_TEXT: Record<string, string> = {
  complete: 'Complete — database and binary storage both covered',
  partial: 'PARTIAL — this recovery point does not cover the whole application',
  unknown: 'UNKNOWN — coverage of this recovery point has not been established',
};

function RequestDetail({ requestId }: { requestId: number }) {
  const detail = useGetRestoreRequestDetail(requestId);

  if (detail.isLoading) return <Skeleton className="h-40 w-full" />;
  if (!detail.data) return null;

  const { request, approvals, executions, validations, precheck, metrics } = detail.data;
  const isProduction = request.environmentSnapshot === 'production';
  const affected = (request.affectedOrganizationIdsSnapshot ?? []) as number[];

  return (
    <div className="space-y-4 border-t pt-4">
      {/* Production is called out in words, not only by colour. */}
      {isProduction && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 p-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <p className="text-sm">
            <span className="font-semibold">PRODUCTION restore.</span> Maker-checker is mandatory and cannot be
            disabled. The requester may not approve this.
          </p>
        </div>
      )}

      {/* Recovery point completeness, stated plainly. */}
      <div className="flex items-start gap-2">
        {request.completeness !== 'complete' && (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
        )}
        <div className="text-sm">
          <div className="font-medium">{COMPLETENESS_TEXT[request.completeness] ?? request.completeness}</div>
          {request.incompleteAcknowledgementNote && (
            <p className="mt-1 text-muted-foreground">
              Risk accepted by the requester: “{request.incompleteAcknowledgementNote}”
            </p>
          )}
        </div>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Recovery point</dt>
          <dd className="font-mono text-xs">
            {request.restorePointType}
            {request.recoveryPointAt ? ` · ${new Date(request.recoveryPointAt).toLocaleString()}` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Pre-restore checkpoint</dt>
          <dd>
            {request.preRestoreCheckpointState === 'unsupported_acknowledged'
              ? 'Not possible — exception acknowledged'
              : request.preRestoreCheckpointState}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Write quiescence</dt>
          <dd>{request.quiescenceState}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Reason</dt>
          <dd>{request.reason}</dd>
        </div>
      </dl>

      {/* Blast radius — the thing an approver is actually consenting to. */}
      <div className="rounded-md border p-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Building2 className="h-4 w-4" aria-hidden />
          Blast radius: {affected.length} organization{affected.length === 1 ? '' : 's'} affected
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          A physical restore rolls back every organization on this installation, not only the one that reported the
          incident.
        </p>
      </div>

      {/* Live precheck — drift is surfaced before anyone approves or dispatches. */}
      {!precheck.ok && (
        <div className="rounded-md border border-destructive/40 p-3">
          <p className="text-sm font-medium">Dispatch is currently blocked</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
            {precheck.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {precheck.driftRequiringAcknowledgement.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Operational state changed since the request ({precheck.driftRequiringAcknowledgement.join(', ')}) — it must be
          re-acknowledged before dispatch.
        </p>
      )}

      {approvals.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium">Approval history</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Decision</TableHead>
                <TableHead>Approver</TableHead>
                <TableHead>Saw</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {approvals.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.decision}</TableCell>
                  <TableCell className="font-mono text-xs">user {a.approverUserId}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {((a.affectedOrganizationIdsAtDecision ?? []) as number[]).length} orgs ·{' '}
                    {a.completenessAtDecision}
                  </TableCell>
                  <TableCell className="text-xs">
                    {a.invalidatedAt ? `Invalidated — ${a.invalidationReason ?? ''}` : 'Standing'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {executions.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium">Execution attempts</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Attempt</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Failure</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {executions.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.attemptNumber}</TableCell>
                  <TableCell>{e.status}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.failureCategory ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {validations.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium">Post-restore validation</h4>
          <ul className="space-y-1 text-sm">
            {validations.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2">
                <Badge variant={v.result === 'passed' ? 'default' : v.result === 'failed' ? 'destructive' : 'outline'}>
                  {v.result}
                </Badge>
                <span className="font-mono text-xs">{v.checkKey}</span>
                <span className="text-xs text-muted-foreground">
                  {v.source === 'automated' ? 'automated' : 'operator attestation'}
                  {v.detail ? ` · ${v.detail}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Observed facts. No compliance verdict is offered. */}
      <p className="text-xs text-muted-foreground">
        Observed: recovery-point age{' '}
        {metrics.recoveryPointAgeMs != null ? `${Math.round(metrics.recoveryPointAgeMs / 60000)} min` : 'unknown'} ·
        execution duration{' '}
        {metrics.executionDurationMs != null ? `${Math.round(metrics.executionDurationMs / 1000)} s` : 'unknown'}.
        These are measurements, not an SLA assessment.
      </p>
    </div>
  );
}

export function RestoreGovernance({ installationId }: { installationId: number }) {
  const requests = useListRestoreRequests(installationId);
  const [open, setOpen] = useState<number | null>(null);

  if (requests.isLoading) return <Skeleton className="h-32 w-full" />;
  if (requests.isError) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Restore governance requires platform restore authority. Being a super admin is not sufficient on its own.
        </CardContent>
      </Card>
    );
  }

  const list = requests.data?.requests ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" aria-hidden />
          Restore governance
        </CardTitle>
        <CardDescription>
          Physical restores are governed here, not executed here. Production always requires a second approver, and an
          approver consents to a blast radius rather than to a request id.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No restore has been requested for this installation.</p>
        ) : (
          list.map((r) => {
            const isOpen = open === r.id;
            return (
              <div key={r.id} className="rounded-lg border p-4">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : r.id)}
                  aria-expanded={isOpen}
                  className="flex w-full flex-wrap items-center justify-between gap-3 text-left"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {r.purpose === 'test' ? 'Restore test' : 'Restore'} #{r.id}
                    </span>
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      {r.environmentSnapshot}
                    </span>
                    {r.completeness !== 'complete' && (
                      <Badge variant="destructive">{r.completeness} recovery point</Badge>
                    )}
                  </span>
                  <Badge variant={statusVariant(r.status)}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                </button>
                {isOpen && <RequestDetail requestId={r.id} />}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
