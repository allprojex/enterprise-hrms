import { useState } from 'react';
import { Boxes, Plus, Settings, ChevronLeft, ChevronRight, Archive, PackageX, RotateCcw, Wrench, UserPlus, Undo2, ShieldAlert, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  useGetMe,
  getGetMeQueryKey,
  useListMyOrganizations,
  getListMyOrganizationsQueryKey,
  useListAssets,
  getListAssetsQueryKey,
  useGetAsset,
  getGetAssetQueryKey,
  useCreateAsset,
  useUpdateAsset,
  useRetireAsset,
  useMarkAssetLost,
  useRecoverAsset,
  useUpdateAssetCondition,
  useAssignAsset,
  useReturnAsset,
  useListAssetAssignments,
  getListAssetAssignmentsQueryKey,
  useListAssetIncidents,
  getListAssetIncidentsQueryKey,
  useReviewAssetIncident,
  useDismissAssetIncident,
  useListMasterDataItems,
  getListMasterDataItemsQueryKey,
  useListBranches,
  getListBranchesQueryKey,
  useListEmployees,
  getListEmployeesQueryKey,
  AssetCondition,
  AssetStatus,
  type Asset,
  type AssetAssignment,
  type AssetIncident,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

const ALL = '__all__';
const PAGE_SIZE = 20;

const STATUS_LABEL: Record<string, string> = {
  available: 'Available',
  assigned: 'Assigned',
  maintenance: 'Maintenance',
  lost: 'Lost',
  retired: 'Retired',
};
const STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  available: 'secondary',
  assigned: 'outline',
  maintenance: 'outline',
  lost: 'destructive',
  retired: 'outline',
};
const CONDITION_LABEL: Record<string, string> = {
  new: 'New',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  damaged: 'Damaged',
};
const INCIDENT_STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  reviewed: 'Reviewed',
  dismissed: 'Dismissed',
};
const INCIDENT_STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  open: 'destructive',
  reviewed: 'secondary',
  dismissed: 'outline',
};
const INCIDENT_TYPE_LABEL: Record<string, string> = {
  damage: 'Damage',
  loss: 'Loss',
};

// --- Lifecycle action dialogs (mandatory-reason pattern, mirrors
// RevokeCertificateDialog in learning-enrollments.tsx) ---

function RetireAssetDialog({ organizationId, asset, onChanged }: { organizationId: number; asset: Asset; onChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const mutation = useRetireAsset();

  if (!['available', 'maintenance', 'lost'].includes(asset.status)) return null;

  const handle = () => {
    if (!reason.trim()) return;
    mutation.mutate(
      { organizationId, id: asset.id, data: { reason: reason.trim() } },
      {
        onSuccess: () => {
          setOpen(false);
          setReason('');
          onChanged();
          toast({ title: 'Asset retired' });
        },
        onError: (err) => toast({ title: 'Could not retire this asset', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setReason(''); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="destructive" data-testid={`button-open-retire-${asset.id}`}>
          <Archive className="h-3.5 w-3.5" aria-hidden="true" />
          Retire…
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Retire Asset</DialogTitle>
          <DialogDescription>This is permanent — there is no reopen path for a retired asset.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor={`retire-reason-${asset.id}`}>Reason (required)</Label>
          <Textarea id={`retire-reason-${asset.id}`} value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`textarea-retire-reason-${asset.id}`} />
        </div>
        <DialogFooter>
          <Button variant="destructive" onClick={handle} disabled={mutation.isPending || !reason.trim()} data-testid={`button-confirm-retire-${asset.id}`}>
            {mutation.isPending ? 'Retiring…' : 'Confirm Retire'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MarkAssetLostDialog({ organizationId, asset, onChanged }: { organizationId: number; asset: Asset; onChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const mutation = useMarkAssetLost();

  if (!['available', 'assigned', 'maintenance'].includes(asset.status)) return null;

  const handle = () => {
    if (!reason.trim()) return;
    mutation.mutate(
      { organizationId, id: asset.id, data: { reason: reason.trim() } },
      {
        onSuccess: () => {
          setOpen(false);
          setReason('');
          onChanged();
          toast({ title: 'Asset marked lost' });
        },
        onError: (err) => toast({ title: 'Could not mark this asset lost', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setReason(''); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="destructive" data-testid={`button-open-mark-lost-${asset.id}`}>
          <PackageX className="h-3.5 w-3.5" aria-hidden="true" />
          Mark Lost…
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark Asset Lost</DialogTitle>
          <DialogDescription>
            {asset.status === 'assigned'
              ? "This asset is currently assigned — its active custody record will be closed as part of this action."
              : 'Marking this asset lost removes it from availability until it is recovered.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor={`lost-reason-${asset.id}`}>Reason (required)</Label>
          <Textarea id={`lost-reason-${asset.id}`} value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`textarea-lost-reason-${asset.id}`} />
        </div>
        <DialogFooter>
          <Button variant="destructive" onClick={handle} disabled={mutation.isPending || !reason.trim()} data-testid={`button-confirm-mark-lost-${asset.id}`}>
            {mutation.isPending ? 'Marking Lost…' : 'Confirm Mark Lost'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecoverAssetDialog({ organizationId, asset, onChanged }: { organizationId: number; asset: Asset; onChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const mutation = useRecoverAsset();

  if (asset.status !== 'lost') return null;

  const handle = () => {
    if (!reason.trim()) return;
    mutation.mutate(
      { organizationId, id: asset.id, data: { reason: reason.trim() } },
      {
        onSuccess: () => {
          setOpen(false);
          setReason('');
          onChanged();
          toast({ title: 'Asset recovered' });
        },
        onError: (err) => toast({ title: 'Could not recover this asset', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setReason(''); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`button-open-recover-${asset.id}`}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Recover…
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Recover Asset</DialogTitle>
          <DialogDescription>Returns this asset to available status.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor={`recover-reason-${asset.id}`}>Reason (required)</Label>
          <Textarea id={`recover-reason-${asset.id}`} value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`textarea-recover-reason-${asset.id}`} />
        </div>
        <DialogFooter>
          <Button onClick={handle} disabled={mutation.isPending || !reason.trim()} data-testid={`button-confirm-recover-${asset.id}`}>
            {mutation.isPending ? 'Recovering…' : 'Confirm Recover'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UpdateConditionDialog({ organizationId, asset, onChanged }: { organizationId: number; asset: Asset; onChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [condition, setCondition] = useState<AssetCondition | ''>('');
  const [reason, setReason] = useState('');
  const mutation = useUpdateAssetCondition();

  const handle = () => {
    if (!condition || !reason.trim()) return;
    mutation.mutate(
      { organizationId, id: asset.id, data: { condition, reason: reason.trim() } },
      {
        onSuccess: () => {
          setOpen(false);
          setCondition('');
          setReason('');
          onChanged();
          toast({ title: 'Condition updated' });
        },
        onError: (err) => toast({ title: 'Could not update condition', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setCondition(''); setReason(''); } }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`button-open-condition-${asset.id}`}>
          <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
          Update Condition…
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update Condition</DialogTitle>
          <DialogDescription>Records a new physical condition with a reason. This does not change the asset's status.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor={`condition-select-${asset.id}`}>New Condition</Label>
            <Select value={condition} onValueChange={(v) => setCondition(v as AssetCondition)}>
              <SelectTrigger id={`condition-select-${asset.id}`} data-testid={`select-condition-${asset.id}`}>
                <SelectValue placeholder="Choose a condition" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CONDITION_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`condition-reason-${asset.id}`}>Reason (required)</Label>
            <Textarea id={`condition-reason-${asset.id}`} value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`textarea-condition-reason-${asset.id}`} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handle} disabled={mutation.isPending || !condition || !reason.trim()} data-testid={`button-confirm-condition-${asset.id}`}>
            {mutation.isPending ? 'Saving…' : 'Confirm Update'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Custody (Phase 3E, W97): issue/return only — no acknowledgement
// control here (ships in W98 alongside the ESS surface that renders it, per
// the frozen plan's own W97 frontend-impact line), no report-issue, no
// incident/maintenance/evidence control. ---

function AssignAssetDialog({ organizationId, asset, onChanged }: { organizationId: number; asset: Asset; onChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [issueCondition, setIssueCondition] = useState<AssetCondition | ''>('');
  const [expectedReturnDate, setExpectedReturnDate] = useState('');
  const [issueNotes, setIssueNotes] = useState('');
  const mutation = useAssignAsset();
  const { data: employeesPage } = useListEmployees(organizationId, { pageSize: 200 }, {
    query: { queryKey: getListEmployeesQueryKey(organizationId, { pageSize: 200 }), enabled: organizationId > 0 && open },
  });

  if (asset.status !== 'available') return null;

  const reset = () => {
    setEmployeeId('');
    setIssueCondition('');
    setExpectedReturnDate('');
    setIssueNotes('');
  };

  const handle = () => {
    if (!employeeId) return;
    mutation.mutate(
      {
        organizationId,
        id: asset.id,
        data: {
          employeeId: Number(employeeId),
          issueCondition: issueCondition || undefined,
          expectedReturnDate: expectedReturnDate || undefined,
          issueNotes: issueNotes.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          setOpen(false);
          reset();
          onChanged();
          toast({ title: 'Asset assigned' });
        },
        onError: (err) => toast({ title: 'Could not assign this asset', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid={`button-open-assign-${asset.id}`}>
          <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
          Assign…
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign Asset</DialogTitle>
          <DialogDescription>Issues custody of this asset to an employee. Creates a new custody history record.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor={`assign-employee-${asset.id}`}>Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger id={`assign-employee-${asset.id}`} data-testid={`select-assign-employee-${asset.id}`}>
                <SelectValue placeholder="Choose an employee" />
              </SelectTrigger>
              <SelectContent>
                {(employeesPage?.items ?? []).map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`assign-condition-${asset.id}`}>Issue Condition (optional — defaults to current condition)</Label>
            <Select value={issueCondition} onValueChange={(v) => setIssueCondition(v as AssetCondition)}>
              <SelectTrigger id={`assign-condition-${asset.id}`} data-testid={`select-assign-condition-${asset.id}`}>
                <SelectValue placeholder={CONDITION_LABEL[asset.condition]} />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CONDITION_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`assign-return-date-${asset.id}`}>Expected Return Date (optional)</Label>
            <Input id={`assign-return-date-${asset.id}`} type="date" value={expectedReturnDate} onChange={(e) => setExpectedReturnDate(e.target.value)} data-testid={`input-assign-return-date-${asset.id}`} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`assign-notes-${asset.id}`}>Notes (optional)</Label>
            <Textarea id={`assign-notes-${asset.id}`} value={issueNotes} onChange={(e) => setIssueNotes(e.target.value)} data-testid={`textarea-assign-notes-${asset.id}`} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handle} disabled={mutation.isPending || !employeeId} data-testid={`button-confirm-assign-${asset.id}`}>
            {mutation.isPending ? 'Assigning…' : 'Confirm Assign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReturnAssetDialog({ organizationId, asset, onChanged }: { organizationId: number; asset: Asset; onChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [returnCondition, setReturnCondition] = useState<AssetCondition | ''>('');
  const [returnNotes, setReturnNotes] = useState('');
  const mutation = useReturnAsset();

  if (asset.status !== 'assigned') return null;

  const reset = () => {
    setReturnCondition('');
    setReturnNotes('');
  };

  const handle = () => {
    mutation.mutate(
      { organizationId, id: asset.id, data: { returnCondition: returnCondition || undefined, returnNotes: returnNotes.trim() || undefined } },
      {
        onSuccess: () => {
          setOpen(false);
          reset();
          onChanged();
          toast({ title: 'Asset returned' });
        },
        onError: (err) => toast({ title: 'Could not return this asset', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`button-open-return-${asset.id}`}>
          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
          Return…
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Return Asset</DialogTitle>
          <DialogDescription>Closes the current custody record and returns this asset to available.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor={`return-condition-${asset.id}`}>Return Condition (optional)</Label>
            <Select value={returnCondition} onValueChange={(v) => setReturnCondition(v as AssetCondition)}>
              <SelectTrigger id={`return-condition-${asset.id}`} data-testid={`select-return-condition-${asset.id}`}>
                <SelectValue placeholder="Not recorded" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CONDITION_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`return-notes-${asset.id}`}>Notes (optional)</Label>
            <Textarea id={`return-notes-${asset.id}`} value={returnNotes} onChange={(e) => setReturnNotes(e.target.value)} data-testid={`textarea-return-notes-${asset.id}`} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handle} disabled={mutation.isPending} data-testid={`button-confirm-return-${asset.id}`}>
            {mutation.isPending ? 'Returning…' : 'Confirm Return'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CustodyPanel({ organizationId, asset, onAssetChanged }: { organizationId: number; asset: Asset; onAssetChanged: () => void }) {
  const queryClient = useQueryClient();
  const { data: assignments, isLoading, error, refetch } = useListAssetAssignments(organizationId, asset.id, {
    query: { queryKey: getListAssetAssignmentsQueryKey(organizationId, asset.id), enabled: organizationId > 0 },
  });

  const handleChanged = () => {
    queryClient.invalidateQueries({ queryKey: getListAssetAssignmentsQueryKey(organizationId, asset.id) });
    onAssetChanged();
    refetch();
  };

  const current = (assignments ?? []).find((a) => a.custodyEndedAt == null);
  const history = (assignments ?? []).filter((a) => a.custodyEndedAt != null);

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <Label>Custody</Label>
        <div className="flex gap-2">
          <AssignAssetDialog organizationId={organizationId} asset={asset} onChanged={handleChanged} />
          <ReturnAssetDialog organizationId={organizationId} asset={asset} onChanged={handleChanged} />
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-14 w-full" />
      ) : error ? (
        <QueryError title="Could not load custody history" message={errorMessage(error) ?? 'Please try again.'} onRetry={() => refetch()} />
      ) : (
        <>
          {current ? (
            <div className="rounded-md border border-border p-3 text-sm" data-testid={`text-current-custody-${asset.id}`}>
              <p className="font-medium text-foreground">Currently assigned — employee #{current.employeeId}</p>
              <p className="text-muted-foreground">
                Issued {new Date(current.issuedAt).toLocaleDateString()}
                {current.expectedReturnDate ? ` · expected back ${new Date(current.expectedReturnDate).toLocaleDateString()}` : ''}
                {' · '}{current.acknowledgedAt ? 'Acknowledged by employee' : 'Not yet acknowledged'}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid={`text-no-current-custody-${asset.id}`}>No one currently holds this asset.</p>
          )}

          {history.length > 0 && (
            <div className="space-y-2">
              {history.map((a: AssetAssignment) => (
                <div key={a.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm" data-testid={`row-custody-history-${a.id}`}>
                  <span className="text-muted-foreground">Employee #{a.employeeId} · {new Date(a.issuedAt).toLocaleDateString()} – {a.custodyEndedAt ? new Date(a.custodyEndedAt).toLocaleDateString() : ''}</span>
                  <Badge variant="outline" className="capitalize">{a.endReason ?? 'closed'}</Badge>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// --- Incident handling (Phase 3E, W99, HR/Asset-Officer): review/dismiss
// only — this page never automatically mutates an asset because an
// incident becomes reviewed. If HR decides a reviewed/dismissed incident
// means the asset is damaged/lost/retired, they use the existing, separate
// lifecycle actions above (Condition/Mark Lost/Recover/Retire) — a
// deliberate, disclosed non-coupling, not a missing feature. No incident
// editing, withdrawal, or reopen control exists anywhere. ---

function ReviewIncidentDialog({ organizationId, incident, onChanged, idPrefix }: { organizationId: number; incident: AssetIncident; onChanged: () => void; idPrefix: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const mutation = useReviewAssetIncident();

  if (incident.status !== 'open') return null;

  const handle = () => {
    mutation.mutate(
      { organizationId, id: incident.id, data: { resolutionNotes: notes.trim() || undefined } },
      {
        onSuccess: () => {
          setOpen(false);
          setNotes('');
          onChanged();
          toast({ title: 'Incident reviewed' });
        },
        onError: (err) => toast({ title: 'Could not review this incident', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setNotes(''); }}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid={`button-open-review-${idPrefix}-${incident.id}`}>
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          Review…
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review Incident</DialogTitle>
          <DialogDescription>
            Marks this report reviewed. This does not itself change the asset's status or condition — use the asset's own actions separately if a change is warranted.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor={`review-notes-${idPrefix}-${incident.id}`}>Resolution Notes (optional)</Label>
          <Textarea id={`review-notes-${idPrefix}-${incident.id}`} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid={`textarea-review-notes-${idPrefix}-${incident.id}`} />
        </div>
        <DialogFooter>
          <Button onClick={handle} disabled={mutation.isPending} data-testid={`button-confirm-review-${idPrefix}-${incident.id}`}>
            {mutation.isPending ? 'Saving…' : 'Confirm Review'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DismissIncidentDialog({ organizationId, incident, onChanged, idPrefix }: { organizationId: number; incident: AssetIncident; onChanged: () => void; idPrefix: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const mutation = useDismissAssetIncident();

  if (incident.status !== 'open') return null;

  const handle = () => {
    mutation.mutate(
      { organizationId, id: incident.id, data: { resolutionNotes: notes.trim() || undefined } },
      {
        onSuccess: () => {
          setOpen(false);
          setNotes('');
          onChanged();
          toast({ title: 'Incident dismissed' });
        },
        onError: (err) => toast({ title: 'Could not dismiss this incident', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setNotes(''); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`button-open-dismiss-${idPrefix}-${incident.id}`}>
          <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
          Dismiss…
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dismiss Incident</DialogTitle>
          <DialogDescription>Marks this report dismissed. This is terminal — there is no reopen action.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor={`dismiss-notes-${idPrefix}-${incident.id}`}>Resolution Notes (optional)</Label>
          <Textarea id={`dismiss-notes-${idPrefix}-${incident.id}`} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid={`textarea-dismiss-notes-${idPrefix}-${incident.id}`} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handle} disabled={mutation.isPending} data-testid={`button-confirm-dismiss-${idPrefix}-${incident.id}`}>
            {mutation.isPending ? 'Saving…' : 'Confirm Dismiss'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IncidentRow({ organizationId, incident, onChanged, showAsset, idPrefix }: { organizationId: number; incident: AssetIncident; onChanged: () => void; showAsset: boolean; idPrefix: string }) {
  return (
    <div className="rounded-md border border-border p-3 space-y-2 text-sm" data-testid={`row-incident-${idPrefix}-${incident.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          {showAsset && <p className="font-medium text-foreground">Asset #{incident.assetId}</p>}
          <p className="text-muted-foreground">
            {INCIDENT_TYPE_LABEL[incident.incidentType] ?? incident.incidentType} · reported by employee #{incident.reportedByEmployeeId} · {new Date(incident.reportedAt).toLocaleDateString()}
          </p>
        </div>
        <Badge variant={INCIDENT_STATUS_VARIANT[incident.status] ?? 'outline'} data-testid={`badge-incident-status-${idPrefix}-${incident.id}`}>
          {INCIDENT_STATUS_LABEL[incident.status] ?? incident.status}
        </Badge>
      </div>
      <p className="text-foreground">{incident.description}</p>
      {incident.resolutionNotes && <p className="text-xs text-muted-foreground">Resolution notes: {incident.resolutionNotes}</p>}
      {incident.status === 'open' && (
        <div className="flex flex-wrap gap-2 pt-1">
          <ReviewIncidentDialog organizationId={organizationId} incident={incident} onChanged={onChanged} idPrefix={idPrefix} />
          <DismissIncidentDialog organizationId={organizationId} incident={incident} onChanged={onChanged} idPrefix={idPrefix} />
        </div>
      )}
    </div>
  );
}

function AssetIncidentsPanel({ organizationId, assetId }: { organizationId: number; assetId: number }) {
  const queryClient = useQueryClient();
  const { data: incidents, isLoading, error, refetch } = useListAssetIncidents(organizationId, undefined, {
    query: { queryKey: getListAssetIncidentsQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const handleChanged = () => {
    queryClient.invalidateQueries({ queryKey: getListAssetIncidentsQueryKey(organizationId) });
    refetch();
  };

  const assetIncidents = (incidents ?? []).filter((i) => i.assetId === assetId);

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <Label>Incidents</Label>
      {isLoading ? (
        <Skeleton className="h-14 w-full" />
      ) : error ? (
        <QueryError title="Could not load incidents" message={errorMessage(error) ?? 'Please try again.'} onRetry={() => refetch()} />
      ) : assetIncidents.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="text-no-asset-incidents">No incidents reported for this asset.</p>
      ) : (
        <div className="space-y-2">
          {assetIncidents.map((incident) => (
            <IncidentRow key={incident.id} organizationId={organizationId} incident={incident} onChanged={handleChanged} showAsset={false} idPrefix="panel" />
          ))}
        </div>
      )}
    </div>
  );
}

function IncidentsQueueSection({ organizationId }: { organizationId: number }) {
  const queryClient = useQueryClient();
  const { data: incidents, isLoading, error, refetch } = useListAssetIncidents(organizationId, undefined, {
    query: { queryKey: getListAssetIncidentsQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const handleChanged = () => {
    queryClient.invalidateQueries({ queryKey: getListAssetIncidentsQueryKey(organizationId) });
    refetch();
  };

  const all = incidents ?? [];
  const open = all.filter((i) => i.status === 'open');
  const resolved = all.filter((i) => i.status !== 'open');

  return (
    <Card>
      <CardContent className="py-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-primary" aria-hidden="true" />
            Incidents
          </h2>
        </div>

        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <QueryError title="Could not load incidents" message={errorMessage(error) ?? 'Please try again.'} onRetry={() => refetch()} />
        ) : all.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-incidents">No incidents have been reported.</p>
        ) : (
          <div className="space-y-4">
            {open.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Open ({open.length})</p>
                {open.map((incident) => (
                  <IncidentRow key={incident.id} organizationId={organizationId} incident={incident} onChanged={handleChanged} showAsset idPrefix="queue" />
                ))}
              </div>
            )}
            {open.length === 0 && <p className="text-sm text-muted-foreground" data-testid="text-no-open-incidents">No open incidents.</p>}
            {resolved.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Resolved</p>
                {resolved.map((incident) => (
                  <IncidentRow key={incident.id} organizationId={organizationId} incident={incident} onChanged={handleChanged} showAsset idPrefix="queue" />
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Assets() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const { data: myOrganizations } = useListMyOrganizations({ query: { queryKey: getListMyOrganizationsQueryKey() } });
  const currentOrg = myOrganizations?.find((m) => m.organizationId === organizationId);
  const isHrCapable = currentOrg?.roles.some((r) => r === 'org_admin' || r === 'hr_manager' || r === 'super_admin') ?? false;

  const { data: branches } = useListBranches(organizationId, {
    query: { queryKey: getListBranchesQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const { data: categoryItems } = useListMasterDataItems(organizationId, 'asset_category', {
    query: { queryKey: getListMasterDataItemsQueryKey(organizationId, 'asset_category'), enabled: organizationId > 0 },
  });

  // --- Filters / list ---
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [conditionFilter, setConditionFilter] = useState(ALL);
  const [branchFilter, setBranchFilter] = useState(ALL);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const resetToFirstPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setPage(1);
    setter(v);
  };

  const listParams = {
    status: statusFilter === ALL ? undefined : (statusFilter as AssetStatus),
    condition: conditionFilter === ALL ? undefined : (conditionFilter as AssetCondition),
    branchId: branchFilter === ALL ? undefined : Number(branchFilter),
    search: search.trim() || undefined,
    page,
    pageSize: PAGE_SIZE,
  };

  const assetsQuery = useListAssets(organizationId, listParams, {
    query: { queryKey: getListAssetsQueryKey(organizationId, listParams), enabled: organizationId > 0 },
  });
  const assets = assetsQuery.data?.items ?? [];
  const total = assetsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // --- Create ---
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createCategoryCode, setCreateCategoryCode] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createManufacturer, setCreateManufacturer] = useState('');
  const [createModel, setCreateModel] = useState('');
  const [createSerialNumber, setCreateSerialNumber] = useState('');
  const [createBranchId, setCreateBranchId] = useState('');
  const [createPurchaseDate, setCreatePurchaseDate] = useState('');
  const [createPurchaseCost, setCreatePurchaseCost] = useState('');
  const [createPurchaseCurrency, setCreatePurchaseCurrency] = useState('');
  const [createWarrantyExpiryDate, setCreateWarrantyExpiryDate] = useState('');
  const [createCondition, setCreateCondition] = useState<AssetCondition | ''>('');
  const [createNotes, setCreateNotes] = useState('');
  const createMutation = useCreateAsset();

  const resetCreateForm = () => {
    setCreateName('');
    setCreateCategoryCode('');
    setCreateDescription('');
    setCreateManufacturer('');
    setCreateModel('');
    setCreateSerialNumber('');
    setCreateBranchId('');
    setCreatePurchaseDate('');
    setCreatePurchaseCost('');
    setCreatePurchaseCurrency('');
    setCreateWarrantyExpiryDate('');
    setCreateCondition('');
    setCreateNotes('');
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim() || !createCategoryCode.trim()) return;
    createMutation.mutate(
      {
        organizationId,
        data: {
          name: createName.trim(),
          categoryCode: createCategoryCode.trim(),
          description: createDescription.trim() || undefined,
          manufacturer: createManufacturer.trim() || undefined,
          model: createModel.trim() || undefined,
          serialNumber: createSerialNumber.trim() || undefined,
          branchId: createBranchId ? Number(createBranchId) : undefined,
          purchaseDate: createPurchaseDate || undefined,
          purchaseCost: createPurchaseCost ? Number(createPurchaseCost) : undefined,
          purchaseCurrency: createPurchaseCurrency.trim() || undefined,
          warrantyExpiryDate: createWarrantyExpiryDate || undefined,
          condition: createCondition || undefined,
          notes: createNotes.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey(organizationId) });
          setCreateOpen(false);
          resetCreateForm();
          toast({ title: 'Asset registered' });
        },
        onError: (err) => toast({ title: 'Could not register this asset', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  // --- Manage (detail dialog: base fields + lifecycle actions) ---
  const [manageId, setManageId] = useState<number | null>(null);
  const {
    data: detail,
    isLoading: detailLoading,
    error: detailError,
  } = useGetAsset(organizationId, manageId ?? 0, {
    query: { queryKey: getGetAssetQueryKey(organizationId, manageId ?? 0), enabled: organizationId > 0 && manageId != null },
  });

  const [editName, setEditName] = useState('');
  const [editCategoryCode, setEditCategoryCode] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editManufacturer, setEditManufacturer] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editSerialNumber, setEditSerialNumber] = useState('');
  const [editBranchId, setEditBranchId] = useState('');
  const [editPurchaseDate, setEditPurchaseDate] = useState('');
  const [editPurchaseCost, setEditPurchaseCost] = useState('');
  const [editPurchaseCurrency, setEditPurchaseCurrency] = useState('');
  const [editWarrantyExpiryDate, setEditWarrantyExpiryDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [formSynced, setFormSynced] = useState(false);

  const openManage = (id: number) => {
    setManageId(id);
    setFormSynced(false);
  };
  const closeManage = () => {
    setManageId(null);
    setFormSynced(false);
  };

  // Sync local edit state whenever a fresh detail loads for the open asset.
  if (detail && manageId === detail.id && !formSynced) {
    setEditName(detail.name);
    setEditCategoryCode(detail.categoryCode);
    setEditDescription(detail.description ?? '');
    setEditManufacturer(detail.manufacturer ?? '');
    setEditModel(detail.model ?? '');
    setEditSerialNumber(detail.serialNumber ?? '');
    setEditBranchId(detail.branchId != null ? String(detail.branchId) : '');
    setEditPurchaseDate(detail.purchaseDate ?? '');
    setEditPurchaseCost(detail.purchaseCost ?? '');
    setEditPurchaseCurrency(detail.purchaseCurrency ?? '');
    setEditWarrantyExpiryDate(detail.warrantyExpiryDate ?? '');
    setEditNotes(detail.notes ?? '');
    setFormSynced(true);
  }

  const updateMutation = useUpdateAsset();

  const invalidateAfterChange = () => {
    queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey(organizationId) });
    if (manageId != null) queryClient.invalidateQueries({ queryKey: getGetAssetQueryKey(organizationId, manageId) });
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (manageId == null || !editName.trim() || !editCategoryCode.trim()) return;
    updateMutation.mutate(
      {
        organizationId,
        id: manageId,
        data: {
          name: editName.trim(),
          categoryCode: editCategoryCode.trim(),
          description: editDescription.trim() || undefined,
          manufacturer: editManufacturer.trim() || undefined,
          model: editModel.trim() || undefined,
          serialNumber: editSerialNumber.trim() || null,
          branchId: editBranchId ? Number(editBranchId) : null,
          purchaseDate: editPurchaseDate || null,
          purchaseCost: editPurchaseCost ? Number(editPurchaseCost) : null,
          purchaseCurrency: editPurchaseCurrency.trim() || null,
          warrantyExpiryDate: editWarrantyExpiryDate || null,
          notes: editNotes.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          invalidateAfterChange();
          toast({ title: 'Asset updated' });
        },
        onError: (err) => toast({ title: 'Could not update this asset', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  if (!isHrCapable) {
    return (
      <div className="p-6 lg:p-8">
        <QueryError title="Not authorized" message="Asset Register is for HR/Asset administrators only." />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <Boxes className="h-7 w-7 text-primary" aria-hidden="true" />
            Asset Register
          </h1>
          <p className="text-muted-foreground">The organization's fixed-asset register — registration, condition, and lifecycle status.</p>
        </div>
        <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetCreateForm(); }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-asset">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Register Asset
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <form onSubmit={handleCreate}>
              <DialogHeader>
                <DialogTitle>Register Asset</DialogTitle>
                <DialogDescription>The asset tag is generated automatically and cannot be set manually.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="asset-name">Name</Label>
                  <Input id="asset-name" value={createName} onChange={(e) => setCreateName(e.target.value)} required data-testid="input-asset-name" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="asset-category">Category Code</Label>
                  <Input
                    id="asset-category"
                    value={createCategoryCode}
                    onChange={(e) => setCreateCategoryCode(e.target.value)}
                    list="asset-category-suggestions"
                    required
                    data-testid="input-asset-category"
                  />
                  <datalist id="asset-category-suggestions">
                    {(categoryItems ?? []).map((item) => (
                      <option key={item.id} value={item.code}>{item.label}</option>
                    ))}
                  </datalist>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="asset-manufacturer">Manufacturer (optional)</Label>
                    <Input id="asset-manufacturer" value={createManufacturer} onChange={(e) => setCreateManufacturer(e.target.value)} data-testid="input-asset-manufacturer" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="asset-model">Model (optional)</Label>
                    <Input id="asset-model" value={createModel} onChange={(e) => setCreateModel(e.target.value)} data-testid="input-asset-model" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="asset-serial">Serial Number (optional)</Label>
                  <Input id="asset-serial" value={createSerialNumber} onChange={(e) => setCreateSerialNumber(e.target.value)} data-testid="input-asset-serial" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="asset-branch">Branch (optional)</Label>
                  <Select value={createBranchId || ALL} onValueChange={(v) => setCreateBranchId(v === ALL ? '' : v)}>
                    <SelectTrigger id="asset-branch" data-testid="select-asset-branch">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>No branch</SelectItem>
                      {(branches ?? []).map((b) => (
                        <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="asset-purchase-date">Purchase Date (optional)</Label>
                    <Input id="asset-purchase-date" type="date" value={createPurchaseDate} onChange={(e) => setCreatePurchaseDate(e.target.value)} data-testid="input-asset-purchase-date" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="asset-warranty">Warranty Expiry (optional)</Label>
                    <Input id="asset-warranty" type="date" value={createWarrantyExpiryDate} onChange={(e) => setCreateWarrantyExpiryDate(e.target.value)} data-testid="input-asset-warranty" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="asset-cost">Purchase Cost (optional)</Label>
                    <Input id="asset-cost" type="number" min={0} step="0.01" value={createPurchaseCost} onChange={(e) => setCreatePurchaseCost(e.target.value)} data-testid="input-asset-cost" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="asset-currency">Currency (optional)</Label>
                    <Input id="asset-currency" value={createPurchaseCurrency} onChange={(e) => setCreatePurchaseCurrency(e.target.value)} placeholder="e.g. GHS" data-testid="input-asset-currency" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="asset-condition">Condition (optional — defaults to Good)</Label>
                  <Select value={createCondition} onValueChange={(v) => setCreateCondition(v as AssetCondition)}>
                    <SelectTrigger id="asset-condition" data-testid="select-asset-condition">
                      <SelectValue placeholder="Good" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CONDITION_LABEL).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="asset-description">Description (optional)</Label>
                  <Textarea id="asset-description" value={createDescription} onChange={(e) => setCreateDescription(e.target.value)} data-testid="input-asset-description" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="asset-notes">Notes (optional)</Label>
                  <Textarea id="asset-notes" value={createNotes} onChange={(e) => setCreateNotes(e.target.value)} data-testid="input-asset-notes" />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-asset">
                  {createMutation.isPending ? 'Registering…' : 'Register Asset'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <IncidentsQueueSection organizationId={organizationId} />

      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1 lg:col-span-2">
              <Label htmlFor="filter-search">Search</Label>
              <Input
                id="filter-search"
                placeholder="Asset tag, name, serial, manufacturer, model…"
                value={search}
                onChange={(e) => { setPage(1); setSearch(e.target.value); }}
                data-testid="input-filter-search"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-status">Status</Label>
              <Select value={statusFilter} onValueChange={resetToFirstPage(setStatusFilter)}>
                <SelectTrigger id="filter-status" data-testid="select-filter-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  {Object.entries(STATUS_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-condition">Condition</Label>
              <Select value={conditionFilter} onValueChange={resetToFirstPage(setConditionFilter)}>
                <SelectTrigger id="filter-condition" data-testid="select-filter-condition">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All conditions</SelectItem>
                  {Object.entries(CONDITION_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-branch">Branch</Label>
              <Select value={branchFilter} onValueChange={resetToFirstPage(setBranchFilter)}>
                <SelectTrigger id="filter-branch" data-testid="select-filter-branch">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All branches</SelectItem>
                  {(branches ?? []).map((b) => (
                    <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {assetsQuery.isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading assets">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : assetsQuery.error ? (
        <QueryError title="Failed to load assets" message="Could not fetch the asset register. Try again." onRetry={() => assetsQuery.refetch()} />
      ) : assets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <Boxes className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No assets found</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Register an asset to start building the register, or adjust the current filters.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table aria-label="Asset register">
            <TableHeader>
              <TableRow>
                <TableHead>Asset Tag</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.map((asset) => (
                <TableRow key={asset.id} data-testid={`row-asset-${asset.id}`}>
                  <TableCell className="font-mono text-sm">{asset.assetTag}</TableCell>
                  <TableCell className="font-medium">{asset.name}</TableCell>
                  <TableCell className="text-muted-foreground">{asset.categoryCode}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[asset.status] ?? 'outline'}>{STATUS_LABEL[asset.status] ?? asset.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{CONDITION_LABEL[asset.condition] ?? asset.condition}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => openManage(asset.id)} data-testid={`button-manage-asset-${asset.id}`}>
                      <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                      Manage
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages} ({total} asset{total === 1 ? '' : 's'})
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} data-testid="button-assets-prev-page">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} data-testid="button-assets-next-page">
              Next
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={manageId !== null} onOpenChange={(open) => !open && closeManage()}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Asset</DialogTitle>
            <DialogDescription>Edit register details and change lifecycle status. Assignment, maintenance, incidents, and evidence are managed elsewhere.</DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : detailError ? (
            <QueryError title="Could not load this asset" message={errorMessage(detailError) ?? 'Please try again.'} />
          ) : !detail ? null : (
            <div className="space-y-6 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono" data-testid="text-manage-asset-tag">{detail.assetTag}</Badge>
                <Badge variant={STATUS_VARIANT[detail.status] ?? 'outline'} data-testid="text-manage-asset-status">{STATUS_LABEL[detail.status] ?? detail.status}</Badge>
                <Badge variant="outline" data-testid="text-manage-asset-condition">{CONDITION_LABEL[detail.condition] ?? detail.condition}</Badge>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <RetireAssetDialog organizationId={organizationId} asset={detail} onChanged={invalidateAfterChange} />
                <MarkAssetLostDialog organizationId={organizationId} asset={detail} onChanged={invalidateAfterChange} />
                <RecoverAssetDialog organizationId={organizationId} asset={detail} onChanged={invalidateAfterChange} />
                <UpdateConditionDialog organizationId={organizationId} asset={detail} onChanged={invalidateAfterChange} />
              </div>

              <CustodyPanel organizationId={organizationId} asset={detail} onAssetChanged={invalidateAfterChange} />

              <AssetIncidentsPanel organizationId={organizationId} assetId={detail.id} />

              <form onSubmit={handleSave} className="space-y-4 border-t border-border pt-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-asset-name">Name</Label>
                  <Input id="edit-asset-name" value={editName} onChange={(e) => setEditName(e.target.value)} required data-testid="input-edit-asset-name" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-asset-category">Category Code</Label>
                  <Input id="edit-asset-category" value={editCategoryCode} onChange={(e) => setEditCategoryCode(e.target.value)} required data-testid="input-edit-asset-category" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="edit-asset-manufacturer">Manufacturer</Label>
                    <Input id="edit-asset-manufacturer" value={editManufacturer} onChange={(e) => setEditManufacturer(e.target.value)} data-testid="input-edit-asset-manufacturer" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-asset-model">Model</Label>
                    <Input id="edit-asset-model" value={editModel} onChange={(e) => setEditModel(e.target.value)} data-testid="input-edit-asset-model" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-asset-serial">Serial Number</Label>
                  <Input id="edit-asset-serial" value={editSerialNumber} onChange={(e) => setEditSerialNumber(e.target.value)} data-testid="input-edit-asset-serial" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-asset-branch">Branch</Label>
                  <Select value={editBranchId || ALL} onValueChange={(v) => setEditBranchId(v === ALL ? '' : v)}>
                    <SelectTrigger id="edit-asset-branch" data-testid="select-edit-asset-branch">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>No branch</SelectItem>
                      {(branches ?? []).map((b) => (
                        <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="edit-asset-purchase-date">Purchase Date</Label>
                    <Input id="edit-asset-purchase-date" type="date" value={editPurchaseDate} onChange={(e) => setEditPurchaseDate(e.target.value)} data-testid="input-edit-asset-purchase-date" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-asset-warranty">Warranty Expiry</Label>
                    <Input id="edit-asset-warranty" type="date" value={editWarrantyExpiryDate} onChange={(e) => setEditWarrantyExpiryDate(e.target.value)} data-testid="input-edit-asset-warranty" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="edit-asset-cost">Purchase Cost</Label>
                    <Input id="edit-asset-cost" type="number" min={0} step="0.01" value={editPurchaseCost} onChange={(e) => setEditPurchaseCost(e.target.value)} data-testid="input-edit-asset-cost" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-asset-currency">Currency</Label>
                    <Input id="edit-asset-currency" value={editPurchaseCurrency} onChange={(e) => setEditPurchaseCurrency(e.target.value)} data-testid="input-edit-asset-currency" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-asset-description">Description</Label>
                  <Textarea id="edit-asset-description" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} data-testid="input-edit-asset-description" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-asset-notes">Notes</Label>
                  <Textarea id="edit-asset-notes" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} data-testid="input-edit-asset-notes" />
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={updateMutation.isPending} data-testid="button-save-asset">
                    {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
                  </Button>
                </div>
              </form>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
