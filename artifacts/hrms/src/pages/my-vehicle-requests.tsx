import { useEffect, useState } from 'react';
import { Car, Send } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryError } from '@/components/query-error';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMe,
  getGetMeQueryKey,
  useListMyVehicleRequests,
  getListMyVehicleRequestsQueryKey,
  useGetMyVehicleRequestContext,
  getGetMyVehicleRequestContextQueryKey,
  useListRequestableVehicles,
  getListRequestableVehiclesQueryKey,
  useSubmitMyVehicleRequest,
  type RequestableVehicle,
} from '@workspace/api-client-react';

function errorMessage(err: unknown, fallback: string): string {
  return (
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
    (err instanceof Error ? err.message : fallback)
  );
}

const STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: 'Awaiting approval', className: 'bg-blue-100 text-blue-900' },
  approved: { label: 'Approved', className: 'bg-green-100 text-green-900' },
  rejected: { label: 'Not approved', className: 'bg-muted text-muted-foreground' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground' },
};

type RequestType = 'employee' | 'department';

/** `datetime-local` wants "YYYY-MM-DDTHH:mm" in the browser's own local time. */
function localDateTimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function vehicleLabel(v: Pick<RequestableVehicle, 'registrationNumber' | 'make' | 'model' | 'description'>): string {
  const makeModel = [v.make, v.model].filter(Boolean).join(' ');
  const detail = makeModel || v.description || '';
  return detail ? `${v.registrationNumber} — ${detail}` : v.registrationNumber;
}

/**
 * VR-02B — Employee Self-Service vehicle requests.
 *
 * SUBMITTING IS AN EXPLICIT GRANT. The form only offers the request types the
 * caller's own permissions allow (write.own → for yourself, write.department →
 * for your department), but that is presentation: the API re-checks every term,
 * so hiding a control here is never what protects anything.
 *
 * NOTHING IDENTITY-BEARING IS SENT. No requester, department or organization
 * leaves this page — the server resolves all of them from the caller. The only
 * reference sent is the chosen vehicle, which the server re-validates.
 *
 * TIMES are entered in the browser's local time and sent as absolute UTC
 * instants (`toISOString()`), the same convention as the rest of the app.
 *
 * The list shows only what this person submitted. There is deliberately no
 * organization-wide view here, whatever else they may hold.
 */
export default function MyVehicleRequests() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const enabled = organizationId > 0;

  const context = useGetMyVehicleRequestContext(organizationId, {
    query: { queryKey: getGetMyVehicleRequestContextQueryKey(organizationId), enabled },
  });
  const requests = useListMyVehicleRequests(organizationId, {
    query: { queryKey: getListMyVehicleRequestsQueryKey(organizationId), enabled },
  });

  const ctx = context.data;
  const canEmployee = ctx?.canSubmitEmployeeRequest ?? false;
  const canDepartment = ctx?.canSubmitDepartmentRequest ?? false;
  const authorized = canEmployee || canDepartment;
  const canSubmitAtAll = authorized && ctx?.blockedReason == null;

  const vehicles = useListRequestableVehicles(organizationId, {
    query: { queryKey: getListRequestableVehiclesQueryKey(organizationId), enabled: enabled && canSubmitAtAll },
  });

  const [formOpen, setFormOpen] = useState(false);
  const [requestType, setRequestType] = useState<RequestType | ''>('');
  const [vehicleId, setVehicleId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [destination, setDestination] = useState('');
  const [timeOut, setTimeOut] = useState('');
  const [timeIn, setTimeIn] = useState('');
  const [lastSubmitted, setLastSubmitted] = useState<{ reference: string; status: string } | null>(null);
  // "Now" for the client-side past-time check, refreshed so a form left open
  // does not keep accepting a start time that has since passed. Render stays
  // pure; the server applies the authoritative check at submission anyway.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // When only one type is permitted there is nothing to choose.
  const effectiveType: RequestType | '' =
    canEmployee && canDepartment ? requestType : canEmployee ? 'employee' : canDepartment ? 'department' : '';

  const resetForm = () => {
    setRequestType('');
    setVehicleId('');
    setPurpose('');
    setDestination('');
    setTimeOut('');
    setTimeIn('');
  };

  const submit = useSubmitMyVehicleRequest({
    mutation: {
      onSuccess: (created) => {
        setLastSubmitted({ reference: created.requestReference, status: created.status });
        toast({ title: `Request ${created.requestReference} submitted`, description: 'It is now awaiting approval.' });
        setFormOpen(false);
        resetForm();
        void queryClient.invalidateQueries({ queryKey: getListMyVehicleRequestsQueryKey(organizationId) });
      },
      onError: (err: unknown) =>
        toast({ title: 'Could not submit', description: errorMessage(err, 'Please try again.'), variant: 'destructive' }),
    },
  });

  // Client-side checks mirror the server's so mistakes are caught early; the
  // server enforces every one of them regardless.
  const out = timeOut ? new Date(timeOut) : null;
  const back = timeIn ? new Date(timeIn) : null;
  const validationError: string | null = !effectiveType
    ? 'Choose who the request is for'
    : !vehicleId
      ? 'Choose a vehicle'
      : purpose.trim().length === 0
        ? 'Purpose is required'
        : !out
          ? 'Planned Time Out is required'
          : !back
            ? 'Expected Time In is required'
            : out.getTime() < nowMs
              ? 'Planned Time Out cannot be in the past'
              : back.getTime() <= out.getTime()
                ? 'Expected Time In must be later than Planned Time Out'
                : null;
  const canSubmitForm = validationError === null && !submit.isPending;

  return (
    <div className="space-y-6" data-testid="page-my-vehicle-requests">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Car className="h-6 w-6" aria-hidden="true" />
          My Vehicle Requests
        </h1>
        <p className="text-muted-foreground mt-1">
          Request one of your organization&apos;s vehicles and follow its progress.
        </p>
      </div>

      {lastSubmitted && (
        <Card data-testid="card-last-submitted">
          <CardContent className="pt-6">
            <p className="font-medium">
              Request <span data-testid="text-last-submitted-reference">{lastSubmitted.reference}</span> submitted.
            </p>
            <p className="text-sm text-muted-foreground">
              Status: {STATUS[lastSubmitted.status]?.label ?? lastSubmitted.status}
            </p>
          </CardContent>
        </Card>
      )}

      {context.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : context.error ? (
        <QueryError onRetry={() => void context.refetch()} />
      ) : !authorized ? (
        <Card data-testid="card-not-authorized">
          <CardContent className="py-6 text-sm text-muted-foreground">
            You have not been authorized to submit vehicle requests. If you need to, ask your administrator.
          </CardContent>
        </Card>
      ) : ctx?.blockedReason ? (
        <Card data-testid="card-submission-blocked">
          <CardContent className="py-6 text-sm">{ctx.blockedReason}</CardContent>
        </Card>
      ) : (
        <Card data-testid="card-new-vehicle-request">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Request a vehicle</CardTitle>
                <CardDescription>
                  {ctx?.department ? <>Your department: {ctx.department.name}.</> : null} Your request goes to the
                  approvers your organization has configured.
                </CardDescription>
              </div>
              {!formOpen && (
                <Button onClick={() => setFormOpen(true)} data-testid="button-open-vehicle-request-form">
                  <Send className="h-4 w-4 mr-2" aria-hidden="true" />
                  New request
                </Button>
              )}
            </div>
          </CardHeader>
          {formOpen && (
            <CardContent>
              <form
                className="space-y-4"
                data-testid="form-vehicle-request"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!canSubmitForm || !out || !back || !effectiveType) return;
                  submit.mutate({
                    organizationId,
                    data: {
                      requestType: effectiveType,
                      vehicleId: Number(vehicleId),
                      purpose: purpose.trim(),
                      destination: destination.trim() ? destination.trim() : null,
                      plannedTimeOut: out.toISOString(),
                      plannedTimeIn: back.toISOString(),
                    },
                  });
                }}
              >
                {canEmployee && canDepartment ? (
                  <div className="space-y-2">
                    <Label htmlFor="vr-type">Who is this request for?</Label>
                    <select
                      id="vr-type"
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={requestType}
                      onChange={(e) => setRequestType(e.target.value as RequestType | '')}
                      data-testid="select-vehicle-request-type"
                    >
                      <option value="">Choose</option>
                      <option value="employee">Myself</option>
                      <option value="department">My department{ctx?.department ? ` (${ctx.department.name})` : ''}</option>
                    </select>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground" data-testid="text-vehicle-request-type">
                    {canEmployee
                      ? 'This request is for yourself.'
                      : `This request is for your department${ctx?.department ? ` (${ctx.department.name})` : ''}.`}
                  </p>
                )}

                <div className="space-y-2">
                  <Label htmlFor="vr-vehicle">Vehicle</Label>
                  {vehicles.isLoading ? (
                    <p className="text-sm text-muted-foreground" data-testid="text-vehicles-loading">
                      Loading vehicles…
                    </p>
                  ) : vehicles.error ? (
                    <p className="text-sm font-medium text-destructive" data-testid="text-vehicles-error">
                      The list of vehicles could not be loaded. Try again shortly.
                    </p>
                  ) : (vehicles.data ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground" data-testid="text-vehicles-empty">
                      No vehicles are currently available to request.
                    </p>
                  ) : (
                    <select
                      id="vr-vehicle"
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={vehicleId}
                      onChange={(e) => setVehicleId(e.target.value)}
                      data-testid="select-vehicle-request-vehicle"
                    >
                      <option value="">Choose a vehicle</option>
                      {(vehicles.data ?? []).map((v) => (
                        <option key={v.id} value={String(v.id)}>
                          {vehicleLabel(v)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="vr-purpose">Purpose</Label>
                  <Textarea
                    id="vr-purpose"
                    rows={3}
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    data-testid="input-vehicle-request-purpose"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vr-destination">Destination (optional)</Label>
                  <Input
                    id="vr-destination"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    data-testid="input-vehicle-request-destination"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="vr-time-out">Planned Time Out</Label>
                    <Input
                      id="vr-time-out"
                      type="datetime-local"
                      min={localDateTimeValue(new Date(nowMs))}
                      value={timeOut}
                      onChange={(e) => setTimeOut(e.target.value)}
                      data-testid="input-vehicle-request-time-out"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vr-time-in">Expected Time In</Label>
                    <Input
                      id="vr-time-in"
                      type="datetime-local"
                      min={timeOut || localDateTimeValue(new Date(nowMs))}
                      value={timeIn}
                      onChange={(e) => setTimeIn(e.target.value)}
                      data-testid="input-vehicle-request-time-in"
                    />
                  </div>
                </div>

                {validationError && (timeOut || timeIn || purpose || vehicleId) ? (
                  <p className="text-sm text-muted-foreground" data-testid="text-vehicle-request-validation">
                    {validationError}
                  </p>
                ) : null}

                <div className="flex gap-2">
                  <Button type="submit" disabled={!canSubmitForm} data-testid="button-submit-vehicle-request">
                    {submit.isPending ? 'Submitting…' : 'Submit request'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setFormOpen(false);
                      resetForm();
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          )}
        </Card>
      )}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Requests you submitted</h2>
        {requests.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : requests.error ? (
          <QueryError onRetry={() => void requests.refetch()} />
        ) : (requests.data ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground" data-testid="text-no-vehicle-requests">
              You have not submitted any vehicle requests.
            </CardContent>
          </Card>
        ) : (
          (requests.data ?? []).map((r) => {
            const style = STATUS[r.status] ?? { label: r.status, className: 'bg-muted' };
            return (
              <Card key={r.id} data-testid={`card-my-vehicle-request-${r.id}`}>
                <CardContent className="pt-6 space-y-1">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">
                        {r.requestReference} ·{' '}
                        {vehicleLabel({
                          registrationNumber: r.vehicleRegistrationNumber,
                          make: r.vehicleMake,
                          model: r.vehicleModel,
                          description: null,
                        })}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {r.requestType === 'department' ? `For ${r.requestingDepartmentName}` : 'For yourself'} ·{' '}
                        {new Date(r.plannedTimeOut).toLocaleString()} → {new Date(r.plannedTimeIn).toLocaleString()}
                      </p>
                    </div>
                    <Badge className={style.className}>{style.label}</Badge>
                  </div>
                  <p className="text-sm">{r.purpose}</p>
                  {r.destination && <p className="text-sm text-muted-foreground">Destination: {r.destination}</p>}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
