import { useState } from 'react';
import { Landmark, Plus, CheckCircle2, ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  useGetMe,
  getGetMeQueryKey,
  useListPayrollStatutoryRuleVersions,
  getListPayrollStatutoryRuleVersionsQueryKey,
  useCreatePayrollStatutoryRuleVersion,
  useValidatePayrollStatutoryRuleVersion,
  useApprovePayrollStatutoryRuleVersion,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

type RuleType = 'paye_bands' | 'pension_rates' | 'pension_earnings_ceiling';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

function isForbidden(err: unknown): boolean {
  return err != null && typeof err === 'object' && 'status' in err && (err as { status: unknown }).status === 403;
}

export default function PayrollStatutoryRules() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const {
    data: versions,
    isLoading,
    error,
  } = useListPayrollStatutoryRuleVersions(
    organizationId,
    {},
    { query: { queryKey: getListPayrollStatutoryRuleVersionsQueryKey(organizationId), enabled: organizationId > 0, retry: false } },
  );

  // Payroll Workstream 1 ships no permission to any existing role by
  // default (docs/PAYROLL_IMPLEMENTATION_PLAN.md §14) — a 403 here is the
  // expected, normal case for every organization until a deliberate future
  // role assignment, mirroring the reactive-403-hide convention every
  // Phase 3H sensitive surface already uses rather than showing a raw error.
  const forbidden = isForbidden(error);

  const [createOpen, setCreateOpen] = useState(false);
  const [ruleType, setRuleType] = useState<RuleType>('paye_bands');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [reasonNote, setReasonNote] = useState('');
  const [employeeRatePercent, setEmployeeRatePercent] = useState('');
  const [employerRatePercent, setEmployerRatePercent] = useState('');
  const [tier1AllocationPercent, setTier1AllocationPercent] = useState('');
  const [tier2AllocationPercent, setTier2AllocationPercent] = useState('');
  const [minimumInsurableEarnings, setMinimumInsurableEarnings] = useState('');
  const [maximumInsurableEarnings, setMaximumInsurableEarnings] = useState('');

  const createMutation = useCreatePayrollStatutoryRuleVersion();
  const validateMutation = useValidatePayrollStatutoryRuleVersion();
  const approveMutation = useApprovePayrollStatutoryRuleVersion();

  const resetCreateForm = () => {
    setRuleType('paye_bands');
    setEffectiveFrom('');
    setSourceUrl('');
    setReasonNote('');
    setEmployeeRatePercent('');
    setEmployerRatePercent('');
    setTier1AllocationPercent('');
    setTier2AllocationPercent('');
    setMinimumInsurableEarnings('');
    setMaximumInsurableEarnings('');
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const base = { ruleType, effectiveFrom: new Date(effectiveFrom).toISOString(), sourceUrl: sourceUrl.trim() || undefined, reasonNote: reasonNote.trim() || undefined };
    const data =
      ruleType === 'pension_rates'
        ? { ...base, pensionRates: { employeeRatePercent, employerRatePercent, tier1AllocationPercent, tier2AllocationPercent } }
        : ruleType === 'pension_earnings_ceiling'
          ? { ...base, pensionEarningsCeiling: { minimumInsurableEarnings: minimumInsurableEarnings || null, maximumInsurableEarnings: maximumInsurableEarnings || null } }
          : // paye_bands requires a full ordered band structure this minimal V1
            // admin form does not yet build — Workstream 1 ships create/
            // validate/approve for pension_rates/pension_earnings_ceiling
            // through the UI; a dedicated band-table editor is left to a
            // later, dedicated frontend pass rather than a hurried minimal
            // form for a genuinely tabular, order-sensitive input.
            base;
    createMutation.mutate(
      { organizationId, data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPayrollStatutoryRuleVersionsQueryKey(organizationId) });
          setCreateOpen(false);
          resetCreateForm();
          toast({ title: 'Draft statutory rule version created' });
        },
        onError: (err) => toast({ title: 'Could not create draft version', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleValidate = (id: number) => {
    validateMutation.mutate(
      { organizationId, id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPayrollStatutoryRuleVersionsQueryKey(organizationId) });
          toast({ title: 'Version validated' });
        },
        onError: (err) => toast({ title: 'Could not validate version', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleApprove = (id: number) => {
    approveMutation.mutate(
      { organizationId, id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPayrollStatutoryRuleVersionsQueryKey(organizationId) });
          toast({ title: 'Version approved' });
        },
        onError: (err) =>
          toast({
            title: 'Could not approve version',
            description: errorMessage(err) ?? 'The creator of a version may not also approve it.',
            variant: 'destructive',
          }),
      },
    );
  };

  if (forbidden) return null;

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <Landmark className="h-7 w-7 text-primary" aria-hidden="true" />
            Payroll Statutory Rules
          </h1>
          <p className="text-muted-foreground">
            Platform-wide, effective-dated Ghana PAYE/SSNIT statutory parameters. No numeric figure here is authoritative until it has gone
            through draft → validated → approved by a different person, per the frozen Payroll plan.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={(open) => (open ? setCreateOpen(true) : (setCreateOpen(false), resetCreateForm()))}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-statutory-rule">
              <Plus className="h-4 w-4" aria-hidden="true" />
              New Draft Version
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleCreate}>
              <DialogHeader>
                <DialogTitle>New Draft Statutory Rule Version</DialogTitle>
                <DialogDescription>Creates a draft only — it has no effect until validated and approved by a different person.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="rule-type">Rule type</Label>
                  <Select value={ruleType} onValueChange={(v) => setRuleType(v as RuleType)}>
                    <SelectTrigger id="rule-type" data-testid="select-rule-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="paye_bands">PAYE Bands</SelectItem>
                      <SelectItem value="pension_rates">Pension Rates</SelectItem>
                      <SelectItem value="pension_earnings_ceiling">Pension Earnings Ceiling</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="effective-from">Effective from</Label>
                  <Input id="effective-from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required data-testid="input-effective-from" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="source-url">Source URL</Label>
                  <Input id="source-url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://gra.gov.gh/..." data-testid="input-source-url" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reason-note">Reason / note</Label>
                  <Input id="reason-note" value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} data-testid="input-reason-note" />
                </div>

                {ruleType === 'pension_rates' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="employee-rate">Employee rate %</Label>
                      <Input id="employee-rate" value={employeeRatePercent} onChange={(e) => setEmployeeRatePercent(e.target.value)} required data-testid="input-employee-rate" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="employer-rate">Employer rate %</Label>
                      <Input id="employer-rate" value={employerRatePercent} onChange={(e) => setEmployerRatePercent(e.target.value)} required data-testid="input-employer-rate" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="tier1-rate">Tier 1 allocation %</Label>
                      <Input id="tier1-rate" value={tier1AllocationPercent} onChange={(e) => setTier1AllocationPercent(e.target.value)} required data-testid="input-tier1-rate" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="tier2-rate">Tier 2 allocation %</Label>
                      <Input id="tier2-rate" value={tier2AllocationPercent} onChange={(e) => setTier2AllocationPercent(e.target.value)} required data-testid="input-tier2-rate" />
                    </div>
                  </div>
                )}

                {ruleType === 'pension_earnings_ceiling' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="min-earnings">Minimum insurable earnings</Label>
                      <Input id="min-earnings" value={minimumInsurableEarnings} onChange={(e) => setMinimumInsurableEarnings(e.target.value)} data-testid="input-min-earnings" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="max-earnings">Maximum insurable earnings</Label>
                      <Input id="max-earnings" value={maximumInsurableEarnings} onChange={(e) => setMaximumInsurableEarnings(e.target.value)} data-testid="input-max-earnings" />
                    </div>
                  </div>
                )}

                {ruleType === 'paye_bands' && (
                  <p className="text-sm text-muted-foreground" data-testid="text-paye-bands-unsupported-inline">
                    PAYE band entry is not yet available in this minimal Workstream 1 admin screen — use the API directly for paye_bands versions
                    until a dedicated band-table editor ships in a later workstream.
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending || ruleType === 'paye_bands'} data-testid="button-submit-statutory-rule">
                  {createMutation.isPending ? 'Creating…' : 'Create Draft'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading statutory rule versions">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : !versions || versions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <Landmark className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No statutory rule versions yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              No Ghana statutory figures are seeded by this workstream. Create a draft version once a value has been verified against an
              authoritative source.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table aria-label="Statutory rule versions">
            <TableHeader>
              <TableRow>
                <TableHead>Rule Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Effective From</TableHead>
                <TableHead>Effective To</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.map((v) => (
                <TableRow key={v.id} data-testid={`row-statutory-rule-${v.id}`}>
                  <TableCell className="font-medium">{v.ruleType}</TableCell>
                  <TableCell>
                    <Badge variant={v.status === 'approved' ? 'secondary' : 'outline'} className="capitalize">
                      {v.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{new Date(v.effectiveFrom).toLocaleDateString()}</TableCell>
                  <TableCell>{v.effectiveTo ? new Date(v.effectiveTo).toLocaleDateString() : 'Open'}</TableCell>
                  <TableCell className="text-right space-x-2">
                    {v.status === 'draft' && (
                      <Button size="sm" variant="outline" onClick={() => handleValidate(v.id)} disabled={validateMutation.isPending} data-testid={`button-validate-${v.id}`}>
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Validate
                      </Button>
                    )}
                    {v.status === 'validated' && (
                      <Button size="sm" onClick={() => handleApprove(v.id)} disabled={approveMutation.isPending} data-testid={`button-approve-${v.id}`}>
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        Approve
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
