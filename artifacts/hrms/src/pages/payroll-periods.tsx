import { useState } from 'react';
import { CalendarClock, Plus, Play, RefreshCw, Trash2, CheckCircle2, Lock, GitCommitHorizontal, FileText, Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  useGetMe,
  getGetMeQueryKey,
  useListPayrollPeriods,
  getListPayrollPeriodsQueryKey,
  useCreatePayrollPeriod,
  useListPayrollRuns,
  getListPayrollRunsQueryKey,
  useCreatePayrollRun,
  useCalculatePayrollRun,
  useApprovePayrollRun,
  useLockPayrollRun,
  useGetPayrollRunLines,
  getGetPayrollRunLinesQueryKey,
  useListPayrollInputReferences,
  getListPayrollInputReferencesQueryKey,
  useCreatePayrollInputReference,
  useDeletePayrollInputReference,
  useListPayrollCorrectionsForRun,
  getListPayrollCorrectionsForRunQueryKey,
  useCreatePayrollCorrection,
  useApprovePayrollCorrection,
  useGetPayrollReport,
  getGetPayrollReportQueryKey,
  getGetPayrollReportUrl,
  useGetPayslip,
  getGetPayslipQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { getStoredToken } from '@/lib/auth';

type PayrollReportKey = 'payroll_register' | 'payroll_paye_schedule' | 'payroll_pension_schedule';

type Frequency = 'monthly' | 'bi_weekly' | 'weekly';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

function employeeErrors(err: unknown): { employeeId: number; error: string }[] | undefined {
  if (!err || typeof err !== 'object' || !('employeeErrors' in err)) return undefined;
  return (err as { employeeErrors: { employeeId: number; error: string }[] }).employeeErrors;
}

function isForbidden(err: unknown): boolean {
  return err != null && typeof err === 'object' && 'status' in err && (err as { status: unknown }).status === 403;
}

export default function PayrollPeriods() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const { data: periods, isLoading, error } = useListPayrollPeriods(organizationId, { query: { queryKey: getListPayrollPeriodsQueryKey(organizationId), enabled: organizationId > 0, retry: false } });
  const forbidden = isForbidden(error);

  const { data: runs } = useListPayrollRuns(organizationId, { query: { queryKey: getListPayrollRunsQueryKey(organizationId), enabled: organizationId > 0, retry: false } });

  const [selectedPeriodId, setSelectedPeriodId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [payDate, setPayDate] = useState('');
  const [calcError, setCalcError] = useState<{ message: string; details?: { employeeId: number; error: string }[] } | null>(null);

  const [inputEmployeeId, setInputEmployeeId] = useState('');
  const [inputCategory, setInputCategory] = useState<'earning' | 'deduction'>('earning');
  const [inputComponentTypeCode, setInputComponentTypeCode] = useState('');
  const [inputAmount, setInputAmount] = useState('');
  const [inputCurrency, setInputCurrency] = useState('GHS');
  const [inputDescription, setInputDescription] = useState('');

  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionLineId, setCorrectionLineId] = useState<number | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');

  const [reportKey, setReportKey] = useState<PayrollReportKey>('payroll_register');
  const [isDownloadingCsv, setIsDownloadingCsv] = useState(false);
  const [payslipLineId, setPayslipLineId] = useState<number | null>(null);

  const createPeriodMutation = useCreatePayrollPeriod();
  const createRunMutation = useCreatePayrollRun();
  const calculateMutation = useCalculatePayrollRun();
  const approveRunMutation = useApprovePayrollRun();
  const lockRunMutation = useLockPayrollRun();
  const createInputMutation = useCreatePayrollInputReference();
  const deleteInputMutation = useDeletePayrollInputReference();
  const createCorrectionMutation = useCreatePayrollCorrection();
  const approveCorrectionMutation = useApprovePayrollCorrection();

  const selectedRun = runs?.find((r) => r.payrollPeriodId === selectedPeriodId) ?? null;

  const { data: runLines } = useGetPayrollRunLines(organizationId, selectedRun?.id ?? 0, {
    query: { queryKey: getGetPayrollRunLinesQueryKey(organizationId, selectedRun?.id ?? 0), enabled: !!selectedRun, retry: false },
  });

  const { data: inputReferences } = useListPayrollInputReferences(organizationId, selectedPeriodId ?? 0, {}, {
    query: { queryKey: getListPayrollInputReferencesQueryKey(organizationId, selectedPeriodId ?? 0), enabled: !!selectedPeriodId, retry: false },
  });

  const { data: corrections } = useListPayrollCorrectionsForRun(organizationId, selectedRun?.id ?? 0, {
    query: { queryKey: getListPayrollCorrectionsForRunQueryKey(organizationId, selectedRun?.id ?? 0), enabled: !!selectedRun && selectedRun.status === 'locked', retry: false },
  });

  const isLocked = selectedRun?.status === 'locked';

  const { data: reportResult } = useGetPayrollReport(organizationId, selectedRun?.id ?? 0, reportKey, {}, {
    query: { queryKey: getGetPayrollReportQueryKey(organizationId, selectedRun?.id ?? 0, reportKey, {}), enabled: !!isLocked, retry: false },
  });

  const { data: payslip } = useGetPayslip(organizationId, selectedRun?.id ?? 0, payslipLineId ?? 0, {
    query: { queryKey: getGetPayslipQueryKey(organizationId, selectedRun?.id ?? 0, payslipLineId ?? 0), enabled: !!isLocked && payslipLineId != null, retry: false },
  });

  const handleDownloadCsv = async () => {
    if (!selectedRun) return;
    setIsDownloadingCsv(true);
    try {
      const token = getStoredToken();
      const res = await fetch(getGetPayrollReportUrl(organizationId, selectedRun.id, reportKey, { format: 'csv' }), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${reportKey}-run-${selectedRun.id}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: 'Could not download report', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setIsDownloadingCsv(false);
    }
  };

  const resetCreateForm = () => {
    setFrequency('monthly');
    setStartDate('');
    setEndDate('');
    setPayDate('');
  };

  const handleCreatePeriod = (e: React.FormEvent) => {
    e.preventDefault();
    createPeriodMutation.mutate(
      {
        organizationId,
        data: { frequency, startDate: new Date(startDate).toISOString(), endDate: new Date(endDate).toISOString(), payDate: new Date(payDate).toISOString() },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPayrollPeriodsQueryKey(organizationId) });
          setCreateOpen(false);
          resetCreateForm();
          toast({ title: 'Payroll period created' });
        },
        onError: (err) => toast({ title: 'Could not create period', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleCreateRun = () => {
    if (!selectedPeriodId) return;
    createRunMutation.mutate(
      { organizationId, data: { payrollPeriodId: selectedPeriodId } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPayrollRunsQueryKey(organizationId) });
          toast({ title: 'Draft payroll run created' });
        },
        onError: (err) => toast({ title: 'Could not create run', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleCalculate = () => {
    if (!selectedRun) return;
    setCalcError(null);
    calculateMutation.mutate(
      { organizationId, id: selectedRun.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPayrollRunsQueryKey(organizationId) });
          queryClient.invalidateQueries({ queryKey: getGetPayrollRunLinesQueryKey(organizationId, selectedRun.id) });
          toast({ title: 'Payroll run calculated' });
        },
        onError: (err) => setCalcError({ message: errorMessage(err) ?? 'Calculation failed', details: employeeErrors(err) }),
      },
    );
  };

  const handleApproveRun = () => {
    if (!selectedRun) return;
    approveRunMutation.mutate(
      { organizationId, id: selectedRun.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPayrollRunsQueryKey(organizationId) });
          toast({ title: 'Payroll run approved' });
        },
        onError: (err) => toast({ title: 'Could not approve run', description: errorMessage(err) ?? 'The membership that prepared this run may not also approve it.', variant: 'destructive' }),
      },
    );
  };

  const handleLockRun = () => {
    if (!selectedRun) return;
    lockRunMutation.mutate(
      { organizationId, id: selectedRun.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPayrollRunsQueryKey(organizationId) });
          toast({ title: 'Payroll run locked' });
        },
        onError: (err) => toast({ title: 'Could not lock run', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleCreateCorrection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRun || correctionLineId == null) return;
    createCorrectionMutation.mutate(
      { organizationId, runId: selectedRun.id, data: { originalRunLineId: correctionLineId, reason: correctionReason } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPayrollCorrectionsForRunQueryKey(organizationId, selectedRun.id) });
          setCorrectionOpen(false);
          setCorrectionReason('');
          setCorrectionLineId(null);
          toast({ title: 'Draft correction created' });
        },
        onError: (err) => toast({ title: 'Could not create correction', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleApproveCorrection = (id: number) => {
    if (!selectedRun) return;
    approveCorrectionMutation.mutate(
      { organizationId, id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPayrollCorrectionsForRunQueryKey(organizationId, selectedRun.id) });
          toast({ title: 'Correction approved' });
        },
        onError: (err) => toast({ title: 'Could not approve correction', description: errorMessage(err) ?? 'The membership that created a correction may not also approve it.', variant: 'destructive' }),
      },
    );
  };

  const resetInputForm = () => {
    setInputEmployeeId('');
    setInputCategory('earning');
    setInputComponentTypeCode('');
    setInputAmount('');
    setInputCurrency('GHS');
    setInputDescription('');
  };

  const handleAddInput = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPeriodId) return;
    createInputMutation.mutate(
      {
        organizationId,
        periodId: selectedPeriodId,
        data: { employeeId: Number(inputEmployeeId), category: inputCategory, componentTypeCode: inputComponentTypeCode, amount: inputAmount, currency: inputCurrency, description: inputDescription.trim() || undefined },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPayrollInputReferencesQueryKey(organizationId, selectedPeriodId) });
          resetInputForm();
          toast({ title: 'One-off input added' });
        },
        onError: (err) => toast({ title: 'Could not add input', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleDeleteInput = (id: number) => {
    if (!selectedPeriodId) return;
    deleteInputMutation.mutate(
      { organizationId, periodId: selectedPeriodId, id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPayrollInputReferencesQueryKey(organizationId, selectedPeriodId) });
          toast({ title: 'Input removed' });
        },
        onError: (err) => toast({ title: 'Could not remove input', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  if (forbidden) return null;

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <CalendarClock className="h-7 w-7 text-primary" aria-hidden="true" />
            Payroll Periods
          </h1>
          <p className="text-muted-foreground">
            Payroll periods, draft calculation, approval, finalization/locking and corrections. A locked run's result is immutable — recalculation and
            one-off-input changes are rejected from that point on; only an approved correction may adjust it, without ever rewriting the original.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={(open) => (open ? setCreateOpen(true) : (setCreateOpen(false), resetCreateForm()))}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-period">
              <Plus className="h-4 w-4" aria-hidden="true" />
              New Period
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleCreatePeriod}>
              <DialogHeader>
                <DialogTitle>New Payroll Period</DialogTitle>
                <DialogDescription>periodKey is computed server-side — never client-supplied.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="frequency">Frequency</Label>
                  <Select value={frequency} onValueChange={(v) => setFrequency(v as Frequency)}>
                    <SelectTrigger id="frequency" data-testid="select-frequency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="bi_weekly">Bi-weekly</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="start-date">Start date</Label>
                  <Input id="start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required data-testid="input-start-date" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="end-date">End date</Label>
                  <Input id="end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required data-testid="input-end-date" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pay-date">Pay date</Label>
                  <Input id="pay-date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} required data-testid="input-pay-date" />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createPeriodMutation.isPending} data-testid="button-submit-period">
                  {createPeriodMutation.isPending ? 'Creating…' : 'Create Period'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading payroll periods">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : !periods || periods.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <CalendarClock className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No payroll periods yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Create a period to begin preparing a draft payroll run.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table aria-label="Payroll periods">
            <TableHeader>
              <TableRow>
                <TableHead>Frequency</TableHead>
                <TableHead>Period Key</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Pay Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {periods.map((p) => (
                <TableRow key={p.id} data-testid={`row-period-${p.id}`} className={selectedPeriodId === p.id ? 'bg-muted/50' : undefined}>
                  <TableCell className="font-medium capitalize">{p.frequency.replace('_', '-')}</TableCell>
                  <TableCell>{p.periodKey}</TableCell>
                  <TableCell>{new Date(p.startDate).toLocaleDateString()}</TableCell>
                  <TableCell>{new Date(p.endDate).toLocaleDateString()}</TableCell>
                  <TableCell>{new Date(p.payDate).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant={selectedPeriodId === p.id ? 'secondary' : 'outline'}
                      onClick={() => {
                        setSelectedPeriodId(p.id);
                        setCalcError(null);
                      }}
                      data-testid={`button-select-period-${p.id}`}
                    >
                      {selectedPeriodId === p.id ? 'Selected' : 'Select'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {selectedPeriodId && (
        <div className="space-y-6" data-testid="section-period-detail">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Payroll Run</CardTitle>
              {!selectedRun ? (
                <Button onClick={handleCreateRun} disabled={createRunMutation.isPending} data-testid="button-create-run">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Create Draft Run
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  {(selectedRun.status === 'draft' || selectedRun.status === 'calculated') && (
                    <Button onClick={handleCalculate} disabled={calculateMutation.isPending} data-testid="button-calculate-run">
                      {selectedRun.status === 'calculated' ? <RefreshCw className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
                      {calculateMutation.isPending ? 'Calculating…' : selectedRun.status === 'calculated' ? 'Recalculate' : 'Calculate'}
                    </Button>
                  )}
                  {selectedRun.status === 'calculated' && (
                    <Button onClick={handleApproveRun} disabled={approveRunMutation.isPending} data-testid="button-approve-run">
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      {approveRunMutation.isPending ? 'Approving…' : 'Approve'}
                    </Button>
                  )}
                  {selectedRun.status === 'approved' && (
                    <Button onClick={handleLockRun} disabled={lockRunMutation.isPending} data-testid="button-lock-run">
                      <Lock className="h-4 w-4" aria-hidden="true" />
                      {lockRunMutation.isPending ? 'Locking…' : 'Lock / Finalize'}
                    </Button>
                  )}
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedRun ? (
                <p className="text-sm text-muted-foreground">No draft run exists for this period yet.</p>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Status:</span>
                    <Badge
                      variant={selectedRun.status === 'locked' ? 'default' : selectedRun.status === 'approved' || selectedRun.status === 'calculated' ? 'secondary' : 'outline'}
                      className="capitalize"
                      data-testid="badge-run-status"
                    >
                      {selectedRun.status}
                    </Badge>
                  </div>

                  {calcError && (
                    <Alert variant="destructive" data-testid="alert-calculation-error">
                      <AlertTitle>Calculation failed — nothing was persisted</AlertTitle>
                      <AlertDescription>
                        <p>{calcError.message}</p>
                        {calcError.details && calcError.details.length > 0 && (
                          <ul className="mt-2 list-disc pl-5">
                            {calcError.details.map((d) => (
                              <li key={d.employeeId}>
                                Employee #{d.employeeId}: {d.error}
                              </li>
                            ))}
                          </ul>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}

                  {runLines && runLines.length > 0 && (
                    <Table aria-label="Payroll run lines">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Employee</TableHead>
                          <TableHead>Staff #</TableHead>
                          <TableHead className="text-right">Gross</TableHead>
                          <TableHead className="text-right">Pension (EE)</TableHead>
                          <TableHead className="text-right">PAYE</TableHead>
                          <TableHead className="text-right">Other Ded.</TableHead>
                          <TableHead className="text-right">Net Pay</TableHead>
                          {selectedRun.status === 'locked' && <TableHead className="text-right">Actions</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {runLines.map(({ line }) => (
                          <TableRow key={line.id} data-testid={`row-run-line-${line.employeeId}`}>
                            <TableCell>#{line.employeeId}</TableCell>
                            <TableCell>{line.staffNumberSnapshot ?? '—'}</TableCell>
                            <TableCell className="text-right">{line.grossEarnings}</TableCell>
                            <TableCell className="text-right">{line.employeePensionDeduction}</TableCell>
                            <TableCell className="text-right">{line.payeAmount}</TableCell>
                            <TableCell className="text-right">{line.otherDeductions}</TableCell>
                            <TableCell className="text-right font-semibold">{line.netPay}</TableCell>
                            {selectedRun.status === 'locked' && (
                              <TableCell className="text-right">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setCorrectionLineId(line.id);
                                    setCorrectionOpen(true);
                                  }}
                                  data-testid={`button-correct-line-${line.employeeId}`}
                                >
                                  <GitCommitHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                                  Correct
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Dialog open={correctionOpen} onOpenChange={(open) => (open ? setCorrectionOpen(true) : (setCorrectionOpen(false), setCorrectionReason(''), setCorrectionLineId(null)))}>
            <DialogContent>
              <form onSubmit={handleCreateCorrection}>
                <DialogHeader>
                  <DialogTitle>New Correction</DialogTitle>
                  <DialogDescription>
                    Never edits the locked line — recalculates from whatever compensation/statutory data is now on file as of the original pay date, and
                    records the result as a new, separately-approved draft.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="correction-reason">Reason</Label>
                    <Input id="correction-reason" value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} required data-testid="input-correction-reason" />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createCorrectionMutation.isPending} data-testid="button-submit-correction">
                    {createCorrectionMutation.isPending ? 'Creating…' : 'Create Draft Correction'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {selectedRun?.status === 'locked' && corrections && corrections.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Corrections</CardTitle>
              </CardHeader>
              <CardContent>
                <Table aria-label="Payroll corrections">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="text-right">Net Pay</TableHead>
                      <TableHead className="text-right">Delta</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {corrections.map((c) => (
                      <TableRow key={c.id} data-testid={`row-correction-${c.id}`}>
                        <TableCell>#{c.employeeId}</TableCell>
                        <TableCell>{c.reason}</TableCell>
                        <TableCell className="text-right">{c.netPay}</TableCell>
                        <TableCell className="text-right">{c.netPayDelta}</TableCell>
                        <TableCell>
                          <Badge variant={c.status === 'approved' ? 'secondary' : 'outline'} className="capitalize">
                            {c.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {c.status === 'draft' && (
                            <Button size="sm" onClick={() => handleApproveCorrection(c.id)} disabled={approveCorrectionMutation.isPending} data-testid={`button-approve-correction-${c.id}`}>
                              Approve
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {isLocked && (
            <Card data-testid="section-payroll-outputs">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">Payroll Outputs</CardTitle>
                <div className="flex items-center gap-2">
                  <Select value={reportKey} onValueChange={(v) => setReportKey(v as PayrollReportKey)}>
                    <SelectTrigger className="w-64" data-testid="select-report-key">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="payroll_register">Payroll Register</SelectItem>
                      <SelectItem value="payroll_paye_schedule">PAYE Schedule</SelectItem>
                      <SelectItem value="payroll_pension_schedule">Pension / SSNIT Schedule</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" onClick={handleDownloadCsv} disabled={isDownloadingCsv} data-testid="button-download-report-csv">
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {reportResult && typeof reportResult === 'object' && 'rows' in reportResult && (
                  <div className="overflow-x-auto">
                    <Table aria-label={reportResult.label} data-testid="table-payroll-report">
                      <TableHeader>
                        <TableRow>
                          {reportResult.columns.map((c) => (
                            <TableHead key={c.key}>{c.label}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reportResult.rows.map((row, i) => (
                          <TableRow key={i} data-testid={`row-payroll-report-${i}`}>
                            {reportResult.columns.map((c) => (
                              <TableCell key={c.key}>{row[c.key] == null ? '—' : String(row[c.key])}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <p className="text-sm text-muted-foreground mt-2" data-testid="text-report-totals">
                      Total Net Pay: {reportResult.totals.netPay ?? '—'}
                    </p>
                  </div>
                )}

                {runLines && runLines.length > 0 && (
                  <div className="space-y-2 pt-4 border-t">
                    <Label>View Payslip</Label>
                    <div className="flex flex-wrap gap-2">
                      {runLines.map(({ line }) => (
                        <Button
                          key={line.id}
                          size="sm"
                          variant={payslipLineId === line.id ? 'secondary' : 'outline'}
                          onClick={() => setPayslipLineId(line.id)}
                          data-testid={`button-view-payslip-${line.employeeId}`}
                        >
                          <FileText className="h-3.5 w-3.5" aria-hidden="true" />#{line.employeeId}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {payslip && (
                  <div className="rounded-md border p-4 space-y-3" data-testid="section-payslip-detail">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold">{payslip.employeeName}</p>
                        <p className="text-sm text-muted-foreground">
                          Staff #{payslip.staffNumberSnapshot ?? '—'} · {payslip.payrollPeriod.periodKey} · Pay date {new Date(payslip.payrollPeriod.payDate).toLocaleDateString()}
                        </p>
                      </div>
                      <Badge variant={payslip.effective.source === 'correction' ? 'default' : 'outline'} data-testid="badge-payslip-effective-source">
                        {payslip.effective.source === 'correction' ? 'Corrected' : 'Original'}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                      <span className="text-muted-foreground">Gross Earnings</span>
                      <span className="text-right" data-testid="text-payslip-original-gross">{payslip.original.grossEarnings}</span>
                      <span className="text-muted-foreground">Employee Pension</span>
                      <span className="text-right">{payslip.original.employeePensionDeduction}</span>
                      <span className="text-muted-foreground">PAYE</span>
                      <span className="text-right">{payslip.original.payeAmount}</span>
                      <span className="text-muted-foreground">Other Deductions</span>
                      <span className="text-right">{payslip.original.otherDeductions}</span>
                      <span className="font-semibold">Net Pay (Original)</span>
                      <span className="text-right font-semibold" data-testid="text-payslip-original-net">{payslip.original.netPay}</span>
                    </div>

                    {payslip.corrections.length > 0 && (
                      <div className="pt-3 border-t space-y-2">
                        <p className="text-sm font-medium">Approved Corrections</p>
                        {payslip.corrections.map((c) => (
                          <div key={c.id} className="text-sm flex items-center justify-between" data-testid={`row-payslip-correction-${c.id}`}>
                            <span className="text-muted-foreground">{c.reason}</span>
                            <span>
                              {c.netPay} (Δ {c.netPayDelta})
                            </span>
                          </div>
                        ))}
                        <p className="text-sm font-semibold flex items-center justify-between pt-1">
                          <span>Effective Net Pay</span>
                          <span data-testid="text-payslip-effective-net">{payslip.effective.netPay}</span>
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">One-off Inputs for this Period</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={handleAddInput} className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
                <div className="space-y-2 col-span-1">
                  <Label htmlFor="input-employee-id">Employee ID</Label>
                  <Input id="input-employee-id" value={inputEmployeeId} onChange={(e) => setInputEmployeeId(e.target.value)} required data-testid="input-oneoff-employee-id" />
                </div>
                <div className="space-y-2 col-span-1">
                  <Label htmlFor="input-category">Category</Label>
                  <Select value={inputCategory} onValueChange={(v) => setInputCategory(v as 'earning' | 'deduction')}>
                    <SelectTrigger id="input-category" data-testid="select-oneoff-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="earning">Earning</SelectItem>
                      <SelectItem value="deduction">Deduction</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 col-span-1">
                  <Label htmlFor="input-component-type">Component type</Label>
                  <Input id="input-component-type" value={inputComponentTypeCode} onChange={(e) => setInputComponentTypeCode(e.target.value)} required data-testid="input-oneoff-component-type" />
                </div>
                <div className="space-y-2 col-span-1">
                  <Label htmlFor="input-amount">Amount</Label>
                  <Input id="input-amount" value={inputAmount} onChange={(e) => setInputAmount(e.target.value)} required data-testid="input-oneoff-amount" />
                </div>
                <div className="space-y-2 col-span-1">
                  <Label htmlFor="input-currency">Currency</Label>
                  <Input id="input-currency" value={inputCurrency} onChange={(e) => setInputCurrency(e.target.value)} required data-testid="input-oneoff-currency" />
                </div>
                <div className="space-y-2 col-span-1">
                  <Button type="submit" disabled={createInputMutation.isPending} data-testid="button-add-oneoff-input" className="w-full">
                    Add
                  </Button>
                </div>
              </form>

              {inputReferences && inputReferences.length > 0 && (
                <Table aria-label="One-off payroll inputs">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Component</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inputReferences.map((i) => (
                      <TableRow key={i.id} data-testid={`row-oneoff-input-${i.id}`}>
                        <TableCell>#{i.employeeId}</TableCell>
                        <TableCell className="capitalize">{i.category}</TableCell>
                        <TableCell>{i.componentTypeCode}</TableCell>
                        <TableCell className="text-right">
                          {i.amount} {i.currency}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => handleDeleteInput(i.id)} disabled={deleteInputMutation.isPending} data-testid={`button-delete-oneoff-${i.id}`}>
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
