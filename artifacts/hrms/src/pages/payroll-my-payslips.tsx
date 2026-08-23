import { useState } from 'react';
import { FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { useGetMe, getGetMeQueryKey, useListOwnPayslips, getListOwnPayslipsQueryKey, useGetOwnPayslip, getGetOwnPayslipQueryKey } from '@workspace/api-client-react';

function isForbidden(err: unknown): boolean {
  return err != null && typeof err === 'object' && 'status' in err && (err as { status: unknown }).status === 403;
}

export default function PayrollMyPayslips() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const { data: summaries, isLoading, error } = useListOwnPayslips(organizationId, {
    query: { queryKey: getListOwnPayslipsQueryKey(organizationId), enabled: organizationId > 0, retry: false },
  });
  const forbidden = isForbidden(error);

  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  const { data: payslip } = useGetOwnPayslip(organizationId, selectedRunId ?? 0, {
    query: { queryKey: getGetOwnPayslipQueryKey(organizationId, selectedRunId ?? 0), enabled: !!selectedRunId, retry: false },
  });

  if (forbidden) return null;

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <FileText className="h-7 w-7 text-primary" aria-hidden="true" />
          My Payslips
        </h1>
        <p className="text-muted-foreground">Payslips are available once your payroll for a period has been finalized/locked.</p>
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading payslips">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : !summaries || summaries.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <FileText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No payslips yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Payslips appear here once a payroll period you were paid for has been finalized.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table aria-label="My payslips">
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Pay Date</TableHead>
                <TableHead className="text-right">Net Pay</TableHead>
                <TableHead>Correction</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaries.map((s) => (
                <TableRow key={s.payrollRunId} data-testid={`row-my-payslip-${s.payrollRunId}`}>
                  <TableCell>{s.payrollPeriod.periodKey}</TableCell>
                  <TableCell>{new Date(s.payrollPeriod.payDate).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    {s.netPay} {s.currency}
                  </TableCell>
                  <TableCell>{s.hasApprovedCorrection && <Badge variant="default">Corrected</Badge>}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant={selectedRunId === s.payrollRunId ? 'secondary' : 'outline'} onClick={() => setSelectedRunId(s.payrollRunId)} data-testid={`button-view-my-payslip-${s.payrollRunId}`}>
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {payslip && (
        <Card data-testid="section-my-payslip-detail">
          <CardHeader>
            <CardTitle className="text-lg">
              Payslip — {payslip.payrollPeriod.periodKey}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Staff #{payslip.staffNumberSnapshot ?? '—'} · Pay date {new Date(payslip.payrollPeriod.payDate).toLocaleDateString()}
            </p>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm max-w-md">
              <span className="text-muted-foreground">Gross Earnings</span>
              <span className="text-right">{payslip.original.grossEarnings}</span>
              <span className="text-muted-foreground">Employee Pension</span>
              <span className="text-right">{payslip.original.employeePensionDeduction}</span>
              <span className="text-muted-foreground">PAYE</span>
              <span className="text-right">{payslip.original.payeAmount}</span>
              <span className="text-muted-foreground">Other Deductions</span>
              <span className="text-right">{payslip.original.otherDeductions}</span>
              <span className="font-semibold">Net Pay</span>
              <span className="text-right font-semibold" data-testid="text-my-payslip-net">
                {payslip.effective.netPay}
              </span>
            </div>
            {payslip.effective.source === 'correction' && (
              <p className="text-sm text-muted-foreground">This payslip reflects an approved correction. The original figure was {payslip.original.netPay}.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
