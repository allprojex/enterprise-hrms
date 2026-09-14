import { useMemo, useState } from 'react';
import { UserRoundCog } from 'lucide-react';
import {
  useListEmployees,
  getListEmployeesQueryKey,
  useCreateFormSubmission,
  type FormTemplateSummary,
  type FormAssistanceReason,
  type Employee,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * "Complete on behalf of employee" (WS-26).
 *
 * This is an exception path and the dialog is written to feel like one: HR must
 * name the employee, classify WHY assistance is needed, and confirm in a final
 * step that says plainly what will be recorded. It is not a shortcut for filling
 * forms faster.
 *
 * Two things it deliberately does NOT do:
 *  - it never accepts a typed employee id. The subject comes from the
 *    tenant-scoped employee list the server already filters by organization, so
 *    a caller cannot reach another tenant's employee by guessing a number.
 *  - it never touches signatures. HR completes content; the employee's own
 *    signature slot still resolves to the employee's membership server-side, so
 *    the confirmation text says so rather than implying HR can finish the form.
 */

const ASSISTANCE_REASONS: { value: FormAssistanceReason; label: string; hint: string }[] = [
  { value: 'system_access_unavailable', label: 'Employee cannot access the system', hint: 'No account yet, locked out, or no device available.' },
  { value: 'medical_or_incapacity', label: 'Medical reason or incapacity', hint: 'Record the category only — keep clinical detail out of the notes.' },
  { value: 'accessibility_assistance', label: 'Accessibility assistance', hint: 'The employee needs support to complete the form themselves.' },
  { value: 'administrative_assistance', label: 'Administrative assistance', hint: 'Routine HR support, e.g. onboarding paperwork.' },
  { value: 'other', label: 'Other (notes required)', hint: 'Explain in the notes below — this is recorded permanently.' },
];

export interface AssistedSubmissionDialogProps {
  organizationId: number;
  /** Only templates whose published version permits assisted completion. */
  templates: FormTemplateSummary[];
  actorName: string;
  onCreated: (submissionId: number, templateTitle: string) => void;
  onError: (message: string) => void;
}

export function AssistedSubmissionDialog({ organizationId, templates, actorName, onCreated, onError }: AssistedSubmissionDialogProps) {
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [reason, setReason] = useState<FormAssistanceReason | ''>('');
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState(false);

  const createMutation = useCreateFormSubmission();

  // Tenant-safe: the server scopes this list to the caller's organization.
  const employeesQuery = useListEmployees(
    organizationId,
    { pageSize: 200 },
    { query: { queryKey: getListEmployeesQueryKey(organizationId, { pageSize: 200 }), enabled: open && organizationId > 0 } },
  );
  const employees = employeesQuery.data?.items ?? [];
  const employee = useMemo(() => employees.find((e: Employee) => String(e.id) === employeeId), [employees, employeeId]);
  const template = useMemo(() => templates.find((t) => String(t.id) === templateId), [templates, templateId]);

  const notesRequired = reason === 'other';
  const ready = templateId !== '' && employeeId !== '' && reason !== '' && (!notesRequired || notes.trim().length > 0);

  const reset = () => {
    setTemplateId('');
    setEmployeeId('');
    setReason('');
    setNotes('');
    setConfirming(false);
  };

  const submit = () => {
    if (!ready || !reason) return;
    createMutation.mutate(
      {
        organizationId,
        data: {
          templateId: Number(templateId),
          subjectEmployeeId: Number(employeeId),
          assistanceReason: reason,
          assistanceNotes: notes.trim() || null,
        },
      },
      {
        onSuccess: (detail) => {
          setOpen(false);
          reset();
          onCreated(detail.submission.id, detail.template.title);
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'data' in err && err.data && typeof err.data === 'object' && 'error' in err.data
              ? String((err.data as { error: unknown }).error)
              : 'Could not start the assisted form.';
          onError(message);
        },
      },
    );
  };

  if (templates.length === 0) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-assisted-submission">
          <UserRoundCog aria-hidden="true" />
          Complete on behalf of employee
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Complete a form on behalf of an employee</DialogTitle>
          <DialogDescription>
            For an employee who genuinely cannot complete the form themselves. The form stays theirs — you are recorded as the
            person who entered it, never as them.
          </DialogDescription>
        </DialogHeader>

        {!confirming ? (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="assisted-template">Form</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger id="assisted-template" data-testid="select-assisted-template">
                  <SelectValue placeholder="Choose a form" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-helper text-foreground-muted">Only forms configured to allow assisted completion are listed.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="assisted-employee">Employee this form is for</Label>
              <Select value={employeeId} onValueChange={setEmployeeId} disabled={employeesQuery.isLoading}>
                <SelectTrigger id="assisted-employee" data-testid="select-assisted-employee">
                  <SelectValue placeholder={employeesQuery.isLoading ? 'Loading employees…' : 'Choose an employee'} />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((e: Employee) => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      {e.firstName} {e.lastName}
                      {e.employeeNumber ? ` · ${e.employeeNumber}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {employee && (
                <p className="text-helper text-foreground-muted" data-testid="text-assisted-employee-context">
                  {employee.firstName} {employee.lastName}
                  {employee.employeeNumber ? ` · ${employee.employeeNumber}` : ''}
                  
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="assisted-reason">Why is assistance needed?</Label>
              <Select value={reason} onValueChange={(v) => setReason(v as FormAssistanceReason)}>
                <SelectTrigger id="assisted-reason" data-testid="select-assisted-reason">
                  <SelectValue placeholder="Choose a reason" />
                </SelectTrigger>
                <SelectContent>
                  {ASSISTANCE_REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {reason !== '' && (
                <p className="text-helper text-foreground-muted">{ASSISTANCE_REASONS.find((r) => r.value === reason)?.hint}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="assisted-notes">Notes{notesRequired ? '' : ' (optional)'}</Label>
              <Textarea
                id="assisted-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={2000}
                rows={3}
                placeholder={notesRequired ? 'Required when the reason is "Other".' : 'Any context worth recording.'}
                data-testid="input-assisted-notes"
              />
              <p className="text-helper text-foreground-muted">
                Notes are stored with the form and visible to people who can already open it. Do not record clinical detail.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2" data-testid="assisted-confirm-panel">
            <div className="rounded-lg border border-border bg-surface-muted p-3 text-body-sm">
              <dl className="space-y-1.5">
                <div className="flex justify-between gap-3">
                  <dt className="text-foreground-muted">Form</dt>
                  <dd className="font-medium">{template?.title}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-foreground-muted">Form for</dt>
                  <dd className="font-medium" data-testid="text-confirm-subject">
                    {employee ? `${employee.firstName} ${employee.lastName}` : ''}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-foreground-muted">Completed by</dt>
                  <dd className="font-medium" data-testid="text-confirm-actor">{actorName}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-foreground-muted">Reason</dt>
                  <dd className="font-medium">{ASSISTANCE_REASONS.find((r) => r.value === reason)?.label}</dd>
                </div>
              </dl>
            </div>
            <p className="text-body-sm text-foreground-muted">
              This is recorded permanently in the form's history and the audit trail: the employee remains the subject, and you
              are recorded as the person who entered it. It is never shown as though they completed it themselves.
            </p>
            <p className="text-body-sm text-foreground-muted">
              Where this form requires the employee's signature, that signature still has to be applied by the employee from
              their own account. Completing it for them does not sign it for them.
            </p>
          </div>
        )}

        <DialogFooter>
          {confirming ? (
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)} data-testid="button-assisted-back">
                Back
              </Button>
              <Button onClick={submit} loading={createMutation.isPending} data-testid="button-assisted-confirm">
                Create assisted form
              </Button>
            </>
          ) : (
            <Button onClick={() => setConfirming(true)} disabled={!ready} data-testid="button-assisted-continue">
              Continue
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
