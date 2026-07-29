import { useState } from 'react';
import { Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  useGetMe,
  getGetMeQueryKey,
  useListMyOrganizations,
  getListMyOrganizationsQueryKey,
  useGetOrganizationConfig,
  getGetOrganizationConfigQueryKey,
  useUpdateOrganizationConfig,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

const WORK_DAYS = [
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
  { value: 'sunday', label: 'Sunday' },
] as const;

interface FormState {
  workStartTime: string;
  workEndTime: string;
  gracePeriodMinutes: string;
  workDays: string[];
}

export default function AttendanceSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  // UX-convenience gate only — organization.update (seeded to org_admin and
  // super_admin only, never hr_manager or employee) is the real,
  // server-enforced authorization for saving this namespace; this just
  // avoids showing an editable form to a role whose save would 403.
  const { data: myOrganizations } = useListMyOrganizations({
    query: { queryKey: getListMyOrganizationsQueryKey() },
  });
  const currentOrg = myOrganizations?.find((m) => m.organizationId === organizationId);
  const canManage = currentOrg?.roles.some((r) => r === 'org_admin' || r === 'super_admin') ?? false;

  const {
    data: config,
    isLoading,
    error,
    refetch,
  } = useGetOrganizationConfig(organizationId, 'attendance', {
    query: { queryKey: getGetOrganizationConfigQueryKey(organizationId, 'attendance'), enabled: organizationId > 0 },
  });
  const updateMutation = useUpdateOrganizationConfig();

  const [form, setForm] = useState<FormState | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  if (config && !form) {
    const data = config.data as Partial<{
      workStartTime: string;
      workEndTime: string;
      gracePeriodMinutes: number;
      workDays: string[];
    }>;
    setForm({
      workStartTime: data.workStartTime ?? '09:00',
      workEndTime: data.workEndTime ?? '17:00',
      gracePeriodMinutes: String(data.gracePeriodMinutes ?? 0),
      workDays: data.workDays ?? [],
    });
  }

  const toggleDay = (day: string, checked: boolean) => {
    setForm((f) =>
      f ? { ...f, workDays: checked ? [...f.workDays, day] : f.workDays.filter((d) => d !== day) } : f,
    );
  };

  const handleSave = () => {
    if (!form) return;
    if (form.workStartTime >= form.workEndTime) {
      setValidationError('Work start time must be earlier than work end time.');
      return;
    }
    setValidationError(null);

    const gracePeriodMinutes = Number(form.gracePeriodMinutes);
    updateMutation.mutate(
      {
        organizationId,
        namespace: 'attendance',
        data: {
          data: {
            workStartTime: form.workStartTime,
            workEndTime: form.workEndTime,
            gracePeriodMinutes,
            workDays: form.workDays,
          },
        },
      },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetOrganizationConfigQueryKey(organizationId, 'attendance'), updated);
          toast({ title: 'Attendance settings saved' });
        },
        onError: (err) =>
          toast({ title: 'Could not save attendance settings', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground">Attendance Settings</h1>
        <p className="text-muted-foreground">
          Organization-wide work hours and grace period — configuration only, not clock-in/out capture
        </p>
      </div>

      {error ? (
        <QueryError title="Could not load attendance settings" onRetry={() => refetch()} />
      ) : isLoading || !form ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Work Schedule</CardTitle>
            <CardDescription>Applies organization-wide; used by future attendance capture, not stored here</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-xl">
              <div className="space-y-2">
                <Label htmlFor="work-start-time">Work start time</Label>
                <Input
                  id="work-start-time"
                  type="time"
                  value={form.workStartTime}
                  onChange={(e) => setForm((f) => (f ? { ...f, workStartTime: e.target.value } : f))}
                  disabled={!canManage}
                  data-testid="input-work-start-time"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="work-end-time">Work end time</Label>
                <Input
                  id="work-end-time"
                  type="time"
                  value={form.workEndTime}
                  onChange={(e) => setForm((f) => (f ? { ...f, workEndTime: e.target.value } : f))}
                  disabled={!canManage}
                  data-testid="input-work-end-time"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="grace-period">Grace period (minutes)</Label>
                <Input
                  id="grace-period"
                  type="number"
                  min={0}
                  max={180}
                  value={form.gracePeriodMinutes}
                  onChange={(e) => setForm((f) => (f ? { ...f, gracePeriodMinutes: e.target.value } : f))}
                  disabled={!canManage}
                  data-testid="input-grace-period"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Work days</Label>
              <div className="flex flex-wrap gap-4">
                {WORK_DAYS.map((day) => (
                  <div key={day.value} className="flex items-center gap-2">
                    <Checkbox
                      id={`work-day-${day.value}`}
                      checked={form.workDays.includes(day.value)}
                      onCheckedChange={(checked) => toggleDay(day.value, checked === true)}
                      disabled={!canManage}
                      data-testid={`checkbox-work-day-${day.value}`}
                    />
                    <Label htmlFor={`work-day-${day.value}`} className="font-normal">{day.label}</Label>
                  </div>
                ))}
              </div>
            </div>

            {validationError && <p className="text-sm text-destructive">{validationError}</p>}

            {canManage && (
              <Button onClick={handleSave} disabled={updateMutation.isPending} data-testid="button-save-attendance-settings">
                <Clock className="h-4 w-4" aria-hidden="true" />
                {updateMutation.isPending ? 'Saving…' : 'Save Attendance Settings'}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
