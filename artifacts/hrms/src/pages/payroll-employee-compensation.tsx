import { useState } from 'react';
import { Wallet, Plus, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  useGetMe,
  getGetMeQueryKey,
  useListEmployeeCompensation,
  getListEmployeeCompensationQueryKey,
  useCreateEmployeeCompensationComponent,
  useGetEmployeeBankingDetail,
  getGetEmployeeBankingDetailQueryKey,
  useCreateEmployeeBankingDetail,
  useGetEmployeeStatutoryIdentifier,
  getGetEmployeeStatutoryIdentifierQueryKey,
  useCreateEmployeeStatutoryIdentifier,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

type Category = 'earning' | 'deduction';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

function isForbidden(err: unknown): boolean {
  return err != null && typeof err === 'object' && 'status' in err && (err as { status: unknown }).status === 403;
}

export default function PayrollEmployeeCompensation() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const [employeeIdInput, setEmployeeIdInput] = useState('');
  const [employeeId, setEmployeeId] = useState<number | null>(null);

  const compensationQuery = useListEmployeeCompensation(organizationId, employeeId ?? 0, {
    query: { queryKey: getListEmployeeCompensationQueryKey(organizationId, employeeId ?? 0), enabled: organizationId > 0 && employeeId != null, retry: false },
  });
  const bankingQuery = useGetEmployeeBankingDetail(organizationId, employeeId ?? 0, {
    query: { queryKey: getGetEmployeeBankingDetailQueryKey(organizationId, employeeId ?? 0), enabled: organizationId > 0 && employeeId != null, retry: false },
  });
  const statutoryQuery = useGetEmployeeStatutoryIdentifier(organizationId, employeeId ?? 0, {
    query: { queryKey: getGetEmployeeStatutoryIdentifierQueryKey(organizationId, employeeId ?? 0), enabled: organizationId > 0 && employeeId != null, retry: false },
  });

  const compensationForbidden = isForbidden(compensationQuery.error);
  const bankingForbidden = isForbidden(bankingQuery.error);
  const statutoryForbidden = isForbidden(statutoryQuery.error);

  // --- Add compensation component ---
  const [compOpen, setCompOpen] = useState(false);
  const [category, setCategory] = useState<Category>('earning');
  const [componentTypeCode, setComponentTypeCode] = useState('basic_salary');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('GHS');
  const [validFrom, setValidFrom] = useState('');
  const [recurring, setRecurring] = useState(true);
  const [pensionable, setPensionable] = useState(false);
  const createCompensation = useCreateEmployeeCompensationComponent();

  const handleAddComponent = (e: React.FormEvent) => {
    e.preventDefault();
    if (employeeId == null) return;
    createCompensation.mutate(
      { organizationId, employeeId, data: { category, componentTypeCode, amount, currency, validFrom: new Date(validFrom).toISOString(), recurring, pensionable } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEmployeeCompensationQueryKey(organizationId, employeeId) });
          setCompOpen(false);
          setAmount('');
          setValidFrom('');
          toast({ title: 'Compensation component assigned' });
        },
        onError: (err) => toast({ title: 'Could not assign component', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  // --- Banking ---
  const [bankOpen, setBankOpen] = useState(false);
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [bankValidFrom, setBankValidFrom] = useState('');
  const createBanking = useCreateEmployeeBankingDetail();

  const handleAddBanking = (e: React.FormEvent) => {
    e.preventDefault();
    if (employeeId == null) return;
    createBanking.mutate(
      { organizationId, employeeId, data: { bankCode, accountNumber, accountName, validFrom: new Date(bankValidFrom).toISOString() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetEmployeeBankingDetailQueryKey(organizationId, employeeId) });
          setBankOpen(false);
          setAccountNumber('');
          setAccountName('');
          toast({ title: 'Banking details set' });
        },
        onError: (err) => toast({ title: 'Could not set banking details', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  // --- Statutory identifiers ---
  const [statOpen, setStatOpen] = useState(false);
  const [ssnitNumber, setSsnitNumber] = useState('');
  const [tin, setTin] = useState('');
  const [statValidFrom, setStatValidFrom] = useState('');
  const createStatutory = useCreateEmployeeStatutoryIdentifier();

  const handleAddStatutory = (e: React.FormEvent) => {
    e.preventDefault();
    if (employeeId == null) return;
    createStatutory.mutate(
      { organizationId, employeeId, data: { ssnitNumber: ssnitNumber || undefined, tin: tin || undefined, validFrom: new Date(statValidFrom).toISOString() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetEmployeeStatutoryIdentifierQueryKey(organizationId, employeeId) });
          setStatOpen(false);
          setSsnitNumber('');
          setTin('');
          toast({ title: 'Statutory identifiers set' });
        },
        onError: (err) => toast({ title: 'Could not set statutory identifiers', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <Wallet className="h-7 w-7 text-primary" aria-hidden="true" />
          Employee Compensation
        </h1>
        <p className="text-muted-foreground">
          Effective-dated compensation, banking, and statutory identifiers — the sole payroll authority for this data. Never calculates
          PAYE, SSNIT, or net pay.
        </p>
      </div>

      <Card>
        <CardContent className="p-6 flex items-end gap-3">
          <div className="space-y-2 flex-1 max-w-xs">
            <Label htmlFor="employee-id-search">Employee ID</Label>
            <Input id="employee-id-search" type="number" value={employeeIdInput} onChange={(e) => setEmployeeIdInput(e.target.value)} data-testid="input-employee-id-search" />
          </div>
          <Button onClick={() => setEmployeeId(employeeIdInput ? Number(employeeIdInput) : null)} data-testid="button-load-employee">
            <Search className="h-4 w-4" aria-hidden="true" />
            Load
          </Button>
        </CardContent>
      </Card>

      {employeeId != null && (
        <>
          {/* Compensation */}
          {compensationForbidden ? null : (
            <Card>
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Current Compensation Components</h2>
                  <Dialog open={compOpen} onOpenChange={setCompOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" data-testid="button-add-component">
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        Add Component
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <form onSubmit={handleAddComponent}>
                        <DialogHeader>
                          <DialogTitle>Assign Compensation Component</DialogTitle>
                          <DialogDescription>Closes any existing open component of the same type — full history is preserved.</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label htmlFor="category">Category</Label>
                            <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
                              <SelectTrigger id="category" data-testid="select-category">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="earning">Earning</SelectItem>
                                <SelectItem value="deduction">Deduction</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="component-type-code">Component Type Code</Label>
                            <Input id="component-type-code" value={componentTypeCode} onChange={(e) => setComponentTypeCode(e.target.value)} required data-testid="input-component-type-code" />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <Label htmlFor="amount">Amount</Label>
                              <Input id="amount" value={amount} onChange={(e) => setAmount(e.target.value)} required data-testid="input-amount" />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="currency">Currency</Label>
                              <Input id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} required data-testid="input-currency" />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="valid-from">Effective from</Label>
                            <Input id="valid-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} required data-testid="input-valid-from" />
                          </div>
                          <div className="flex gap-4">
                            <label className="flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} data-testid="checkbox-recurring" />
                              Recurring
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={pensionable} onChange={(e) => setPensionable(e.target.checked)} data-testid="checkbox-pensionable" />
                              Pensionable
                            </label>
                          </div>
                        </div>
                        <DialogFooter>
                          <Button type="submit" disabled={createCompensation.isPending} data-testid="button-submit-component">
                            {createCompensation.isPending ? 'Assigning…' : 'Assign'}
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>

                {!compensationQuery.data || compensationQuery.data.length === 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="text-no-components">
                    No compensation components on file.
                  </p>
                ) : (
                  <Table aria-label="Compensation components">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead>Component</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Effective From</TableHead>
                        <TableHead>Recurring</TableHead>
                        <TableHead>Pensionable</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {compensationQuery.data.map((c) => (
                        <TableRow key={c.id} data-testid={`row-component-${c.id}`}>
                          <TableCell>
                            <Badge variant={c.category === 'earning' ? 'secondary' : 'outline'} className="capitalize">
                              {c.category}
                            </Badge>
                          </TableCell>
                          <TableCell>{c.componentTypeCode}</TableCell>
                          <TableCell>
                            {c.amount} {c.currency}
                          </TableCell>
                          <TableCell>{new Date(c.validFrom).toLocaleDateString()}</TableCell>
                          <TableCell>{c.recurring ? 'Yes' : 'No'}</TableCell>
                          <TableCell>{c.pensionable ? 'Yes' : 'No'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}

          {/* Banking */}
          {bankingForbidden ? null : (
            <Card>
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Banking Details</h2>
                  <Dialog open={bankOpen} onOpenChange={setBankOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline" data-testid="button-add-banking">
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        Set Banking Details
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <form onSubmit={handleAddBanking}>
                        <DialogHeader>
                          <DialogTitle>Set Banking Details</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label htmlFor="bank-code">Bank Code</Label>
                            <Input id="bank-code" value={bankCode} onChange={(e) => setBankCode(e.target.value)} required data-testid="input-bank-code" />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="account-number">Account Number</Label>
                            <Input id="account-number" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} required data-testid="input-account-number" />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="account-name">Account Name</Label>
                            <Input id="account-name" value={accountName} onChange={(e) => setAccountName(e.target.value)} required data-testid="input-account-name" />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="bank-valid-from">Effective from</Label>
                            <Input id="bank-valid-from" type="date" value={bankValidFrom} onChange={(e) => setBankValidFrom(e.target.value)} required data-testid="input-bank-valid-from" />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button type="submit" disabled={createBanking.isPending} data-testid="button-submit-banking">
                            {createBanking.isPending ? 'Saving…' : 'Save'}
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>
                {bankingQuery.data ? (
                  <p className="text-sm" data-testid="text-current-banking">
                    {bankingQuery.data.bankCode} · {bankingQuery.data.accountName} · ****{bankingQuery.data.accountNumber.slice(-4)}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground" data-testid="text-no-banking">
                    No banking details on file.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Statutory identifiers */}
          {statutoryForbidden ? null : (
            <Card>
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Statutory Identifiers</h2>
                  <Dialog open={statOpen} onOpenChange={setStatOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline" data-testid="button-add-statutory-identifier">
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        Set Identifiers
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <form onSubmit={handleAddStatutory}>
                        <DialogHeader>
                          <DialogTitle>Set Statutory Identifiers</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label htmlFor="ssnit-number">SSNIT Number</Label>
                            <Input id="ssnit-number" value={ssnitNumber} onChange={(e) => setSsnitNumber(e.target.value)} data-testid="input-ssnit-number" />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="tin">TIN</Label>
                            <Input id="tin" value={tin} onChange={(e) => setTin(e.target.value)} data-testid="input-tin" />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="stat-valid-from">Effective from</Label>
                            <Input id="stat-valid-from" type="date" value={statValidFrom} onChange={(e) => setStatValidFrom(e.target.value)} required data-testid="input-stat-valid-from" />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button type="submit" disabled={createStatutory.isPending} data-testid="button-submit-statutory-identifier">
                            {createStatutory.isPending ? 'Saving…' : 'Save'}
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>
                {statutoryQuery.data ? (
                  <p className="text-sm" data-testid="text-current-statutory">
                    SSNIT: {statutoryQuery.data.ssnitNumber ?? '—'} · TIN: {statutoryQuery.data.tin ?? '—'}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground" data-testid="text-no-statutory">
                    No statutory identifiers on file.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
