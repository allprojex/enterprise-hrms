import { useEffect, useState, type ReactNode } from 'react';
import { useForm, useFieldArray, useFormContext, useWatch, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Camera, Lock, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { Employee } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { ConfirmActionDialog, SectionHeader } from '@/components/foundation';
import { NavigationGuard } from '@/components/navigation-guard';
import { releaseNavigationGuard } from '@/lib/navigation-guard-registry';
import type { EmployeeApiErrorDetails } from '@/lib/employee-api-error';
import {
  RESTRICTED_FIELDS_CHANGED,
  SELF_ADMINISTRATION_FORBIDDEN,
  SELF_ADMINISTRATION_MESSAGE,
} from '@/lib/employee-api-error';
import { cn } from '@/lib/utils';
import { EmployeeManagerPicker } from './employee-manager-picker';
import {
  ADMINISTRATIVE_STATUS_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  FIELD_LABEL,
  GENDER_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  STATUS_LABEL,
  employeeFormSchema,
  type EmployeeFormValues,
} from './employee-form-schema';

/**
 * The one employee form, used for registration (/employees/new) and editing
 * (/employees/:id/edit).
 *
 * It owns presentation and client-side validation only. The PAGE that mounts
 * it builds the API body from the submitted values (toCreatePayload /
 * buildUpdatePatch) and talks to the server; the server remains the authority
 * on permissions, status transitions, uniqueness and self-administration —
 * every rule mirrored here exists to tell the person sooner, not to decide.
 *
 * Sensitive fields (employeeRecordPolicy.SENSITIVE_EMPLOYEE_WRITE_FIELDS) are
 * rendered disabled when the caller lacks employee.sensitive.write, and
 * hidden when the record arrived redacted (no employee.sensitive.read): a
 * disabled, prefilled field is never submitted, and a redacted null is never
 * echoed back as an erasure.
 */

const NONE = '__none__';

export interface EmployeeFormLookups {
  departments: { id: number; name: string }[];
  branches: { id: number; name: string }[];
  positions: { id: number; name: string }[];
}

export interface EmployeeFormAccess {
  canWriteSensitive: boolean;
  canReadNotes: boolean;
  canAllocateNumber: boolean;
}

export interface EmployeePhotoDraft {
  previewUrl: string | null;
  onSelect: (file: File) => void;
  onClear: () => void;
}

export interface EmployeeFormProps {
  mode: 'create' | 'edit';
  organizationId: number;
  initialValues: EmployeeFormValues;
  /** Edit only — the stored record, for status rules and the manager's name. */
  original?: Employee;
  access: EmployeeFormAccess;
  lookups: EmployeeFormLookups;
  onSubmit: (values: EmployeeFormValues) => void | Promise<void>;
  onCancel: () => void;
  isPending: boolean;
  /** The last failed submission, interpreted; the form maps it onto fields. */
  serverError: EmployeeApiErrorDetails | null;
  /** Create only — a photo chosen now becomes the profile picture after creation. */
  photo?: EmployeePhotoDraft;
  /** Edit only — nothing has changed, so there is nothing to save. */
  showNoChangesHint?: boolean;
  /** Clears `serverError` (used after undoing restricted changes). */
  onDismissError?: () => void;
}

const SECTIONS = [
  { id: 'personal', label: 'Personal information' },
  { id: 'contact', label: 'Contact information' },
  { id: 'emergency', label: 'Emergency contacts' },
  { id: 'employment', label: 'Employment information' },
  { id: 'notes', label: 'HR notes' },
] as const;

export function EmployeeForm({
  mode,
  organizationId,
  initialValues,
  original,
  access,
  lookups,
  onSubmit,
  onCancel,
  isPending,
  serverError,
  photo,
  showNoChangesHint = false,
  onDismissError,
}: EmployeeFormProps) {
  const form = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: initialValues,
    mode: 'onBlur',
  });
  const { isDirty } = form.formState;
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const restrictedChange = serverError?.code === RESTRICTED_FIELDS_CHANGED;

  // Resolve a refused mixed edit: put every restricted field back to its
  // stored value (the inputs are disabled, so the user could not do this by
  // hand), then let the page clear the error so the permitted changes can be
  // submitted on their own.
  const undoRestrictedChanges = () => {
    for (const key of serverError?.fields ?? []) {
      if (key in initialValues) form.resetField(key as FieldPath<EmployeeFormValues>);
    }
    onDismissError?.();
  };

  const redacted = mode === 'edit' && original?.sensitiveFieldsRedacted === true;
  const sensitiveVisible = !redacted;
  const sensitiveEditable = sensitiveVisible && access.canWriteSensitive;
  const notesEditable = access.canReadNotes;
  const [managerLabel, setManagerLabel] = useState<string | null>(original?.reportingManagerName ?? null);

  // The server's verdict, laid onto the fields it named.
  useEffect(() => {
    if (!serverError) return;
    for (const key of serverError.fields) {
      if (key in initialValues) {
        form.setError(key as FieldPath<EmployeeFormValues>, {
          type: 'server',
          message: `Changing this requires the ${serverError.requiredPermission ?? 'sensitive-write'} permission`,
        });
      }
    }
    if (serverError.field && serverError.field in initialValues) {
      form.setError(serverError.field as FieldPath<EmployeeFormValues>, {
        type: 'server',
        message: serverError.message ?? 'This value is already in use in your organisation',
      });
    }
  }, [serverError, form, initialValues]);

  const status = useWatch({ control: form.control, name: 'employmentStatus' });
  const originalStatus = original?.employmentStatus;
  const statusLocked = mode === 'edit' && originalStatus === 'terminated';

  const handleCancel = () => {
    if (isDirty) setConfirmDiscard(true);
    else onCancel();
  };

  const submitLabel = mode === 'create' ? 'Register employee' : 'Save changes';

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => onSubmit(values))}
        noValidate
        className="xl:grid xl:grid-cols-[200px_minmax(0,1fr)] xl:gap-10"
        data-testid="form-employee"
        aria-busy={isPending || undefined}
      >
        <nav aria-label="Form sections" className="hidden xl:block">
          <ol className="sticky top-24 space-y-1 text-body-sm">
            {SECTIONS.filter((s) => s.id !== 'notes' || notesEditable).map((s) => (
              <li key={s.id}>
                <a
                  href={`#employee-form-${s.id}`}
                  className="block rounded-md px-3 py-1.5 text-foreground-muted hover:bg-surface-hover hover:text-foreground"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0 space-y-10">
          {serverError && serverError.fields.length === 0 && !serverError.field && (
            <Alert variant="destructive" role="alert" data-testid="alert-employee-form-error">
              <AlertCircle className="size-4" aria-hidden="true" />
              <AlertTitle>
                {serverError.code === SELF_ADMINISTRATION_FORBIDDEN
                  ? 'You cannot administer your own record'
                  : mode === 'create'
                    ? 'The employee could not be registered'
                    : 'The changes could not be saved'}
              </AlertTitle>
              <AlertDescription>
                {serverError.code === SELF_ADMINISTRATION_FORBIDDEN
                  ? serverError.message ?? SELF_ADMINISTRATION_MESSAGE
                  : serverError.message ?? 'Please check the details and try again.'}
              </AlertDescription>
            </Alert>
          )}
          {restrictedChange && serverError && (
            <Alert variant="destructive" role="alert" data-testid="alert-employee-restricted-changes">
              <AlertCircle className="size-4" aria-hidden="true" />
              <AlertTitle>Some of your changes cannot be saved</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>
                  You changed {serverError.fields.map((f) => FIELD_LABEL[f] ?? f).join(', ')}, which your permissions no
                  longer allow you to change. Nothing has been saved. Undo those changes to save the rest, or ask an
                  officer who holds the permission to make them.
                </p>
                <Button type="button" variant="outline" size="sm" onClick={undoRestrictedChanges} data-testid="button-undo-restricted-changes">
                  <RotateCcw className="size-4" aria-hidden="true" />
                  Undo changes to restricted fields
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {serverError && !restrictedChange && (serverError.fields.length > 0 || serverError.field) && (
            <Alert variant="destructive" role="alert" data-testid="alert-employee-form-error">
              <AlertCircle className="size-4" aria-hidden="true" />
              <AlertTitle>{serverError.fields.length > 0 ? 'Some fields were refused' : 'A value is already in use'}</AlertTitle>
              <AlertDescription>
                {serverError.fields.length > 0
                  ? `${serverError.fields.map((f) => FIELD_LABEL[f] ?? f).join(', ')}: ${serverError.message ?? 'not permitted for your role.'}`
                  : serverError.message ?? 'Check the highlighted field.'}
              </AlertDescription>
            </Alert>
          )}

          {/* ---------------------------------------------------------------- */}
          <FormSection id="personal" title="Personal information" description="Names as they should appear on HR records.">
            {photo && (
              <div className="sm:col-span-2 flex items-center gap-4">
                <Avatar className="size-20">
                  {photo.previewUrl && <AvatarImage src={photo.previewUrl} alt="" />}
                  <AvatarFallback className="bg-muted">
                    <Camera className="size-6 text-foreground-muted" aria-hidden="true" />
                  </AvatarFallback>
                </Avatar>
                <div className="space-y-1.5">
                  <label htmlFor="employee-photo" className="text-label text-foreground">
                    Photograph <span className="text-foreground-muted">(optional)</span>
                  </label>
                  <input
                    id="employee-photo"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="block w-full text-body-sm"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) photo.onSelect(file);
                    }}
                    data-testid="input-employee-photo"
                  />
                  <p className="text-helper text-foreground-muted">JPEG, PNG or WebP up to 5 MB. Uploaded after the record is created.</p>
                  {photo.previewUrl && (
                    <Button type="button" variant="ghost" size="sm" onClick={photo.onClear} data-testid="button-clear-photo">
                      Remove photo
                    </Button>
                  )}
                </div>
              </div>
            )}
            <TextField name="firstName" label="First name" required autoComplete="off" />
            <TextField name="lastName" label="Last name" required autoComplete="off" />
            <TextField name="middleName" label="Middle name" />
            <TextField name="preferredName" label="Preferred name" description="How colleagues address them, if different." />

            <SensitiveGroup visible={sensitiveVisible} editable={sensitiveEditable} mode={mode}>
              <SelectField name="gender" label="Gender" options={GENDER_OPTIONS} disabled={!sensitiveEditable} />
              <TextField name="dateOfBirth" label="Date of birth" type="date" disabled={!sensitiveEditable} />
              <SelectField name="maritalStatus" label="Marital status" options={MARITAL_STATUS_OPTIONS} disabled={!sensitiveEditable} />
              <TextField name="nationality" label="Nationality" disabled={!sensitiveEditable} />
              <TextField
                name="nationalId"
                label="National ID number"
                disabled={!sensitiveEditable}
                description="Must be unique within the organisation."
              />
              <TextField
                name="passportNumber"
                label="Passport number"
                disabled={!sensitiveEditable}
                description="Must be unique within the organisation."
              />
            </SensitiveGroup>
          </FormSection>

          {/* ---------------------------------------------------------------- */}
          <FormSection id="contact" title="Contact information" description="Work contact details are general; personal contact details are sensitive.">
            <TextField name="workEmail" label="Work email" type="email" autoComplete="off" inputMode="email" />
            <SensitiveGroup visible={sensitiveVisible} editable={sensitiveEditable} mode={mode} compact>
              <TextField name="personalEmail" label="Personal email" type="email" inputMode="email" disabled={!sensitiveEditable} />
              <TextField name="phoneNumber" label="Primary phone" type="tel" inputMode="tel" disabled={!sensitiveEditable} />
              <TextField name="alternatePhoneNumber" label="Alternative phone" type="tel" inputMode="tel" disabled={!sensitiveEditable} />
              <div className="sm:col-span-2">
                <p className="text-label text-foreground">Residential address</p>
              </div>
              <TextField name="residentialAddress.line1" label="Address line 1" disabled={!sensitiveEditable} className="sm:col-span-2" />
              <TextField name="residentialAddress.line2" label="Address line 2" disabled={!sensitiveEditable} className="sm:col-span-2" />
              <TextField name="residentialAddress.city" label="City / town" disabled={!sensitiveEditable} />
              <TextField name="residentialAddress.state" label="Region / state" disabled={!sensitiveEditable} />
              <TextField name="residentialAddress.postalCode" label="Postal code" disabled={!sensitiveEditable} />
              <TextField name="residentialAddress.country" label="Country" disabled={!sensitiveEditable} />
            </SensitiveGroup>
          </FormSection>

          {/* ---------------------------------------------------------------- */}
          <FormSection id="emergency" title="Emergency contacts" description="Who to reach in an emergency. Each contact needs a name, relationship and phone number.">
            <SensitiveGroup visible={sensitiveVisible} editable={sensitiveEditable} mode={mode} compact>
              <EmergencyContactsFields disabled={!sensitiveEditable} />
            </SensitiveGroup>
          </FormSection>

          {/* ---------------------------------------------------------------- */}
          <FormSection id="employment" title="Employment information" description="Placement and terms. Changes to status beyond these options use the lifecycle actions on the profile.">
            {mode === 'create' &&
              (access.canAllocateNumber ? (
                <TextField
                  name="employeeNumber"
                  label="Employee number"
                  description="Leave blank to generate the next number automatically."
                  className="sm:col-span-2"
                />
              ) : (
                <p className="sm:col-span-2 text-body-sm text-foreground-muted" data-testid="text-employee-number-auto">
                  An employee number will be generated automatically when the record is created.
                </p>
              ))}
            <LookupSelectField name="departmentId" label="Department" items={lookups.departments} noneLabel="No department" />
            <LookupSelectField name="branchId" label="Branch" items={lookups.branches} noneLabel="No branch" />
            <LookupSelectField name="positionId" label="Position / job title" items={lookups.positions} noneLabel="No position" />
            <FormField
              control={form.control}
              name="reportingManagerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reporting manager</FormLabel>
                  <FormControl>
                    <EmployeeManagerPicker
                      organizationId={organizationId}
                      value={field.value}
                      valueLabel={managerLabel}
                      excludeEmployeeId={original?.id}
                      onChange={({ id, label }) => {
                        field.onChange(id);
                        setManagerLabel(label || null);
                      }}
                    />
                  </FormControl>
                  <FormDescription>An active employee of this organisation. The employee cannot report to themself.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <TextField name="hireDate" label="Hire date" type="date" />
            <TextField name="probationEndDate" label="Probation end date" type="date" description="On or after the hire date." />
            <SelectField name="employmentType" label="Employment type" options={EMPLOYMENT_TYPE_OPTIONS} />
            <FormField
              control={form.control}
              name="employmentStatus"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Employment status</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={statusLocked}>
                    <FormControl>
                      <SelectTrigger data-testid="select-employee-employment-status">
                        <SelectValue placeholder="Choose a status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {statusLocked && <SelectItem value="terminated">Terminated</SelectItem>}
                      {ADMINISTRATIVE_STATUS_OPTIONS.map((o) => {
                        const confirmOnly = mode === 'edit' && originalStatus === 'probation' && o.value === 'active';
                        return (
                          <SelectItem key={o.value} value={o.value} disabled={confirmOnly}>
                            {o.label}
                            {confirmOnly ? ' — use Confirm' : ''}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {statusLocked
                      ? 'A separated employee is reactivated with the Rehire action on the profile.'
                      : originalStatus === 'probation'
                        ? 'Ending probation uses the Confirm action on the profile, which records the review.'
                        : 'Separation uses the Separate action on the profile so the date and reason are recorded.'}
                  </FormDescription>
                  <FormMessage />
                  {status !== originalStatus && mode === 'edit' && !statusLocked && (
                    <p className="text-helper text-foreground-muted">
                      Changing from {STATUS_LABEL[originalStatus ?? ''] ?? originalStatus} to {STATUS_LABEL[status] ?? status}.
                    </p>
                  )}
                </FormItem>
              )}
            />
            <TextField name="workLocation" label="Work location" description="Free text, e.g. Head office, Kumasi site." className="sm:col-span-2" />
          </FormSection>

          {/* ---------------------------------------------------------------- */}
          {notesEditable && (
            <FormSection id="notes" title="HR notes" description="Internal notes visible only to holders of the notes permission. Never shown to the employee.">
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea rows={4} {...field} data-testid="input-employee-notes" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormSection>
          )}

          {/* ---------------------------------------------------------------- */}
          <div
            className={cn(
              'sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur',
              'sm:-mx-6 sm:flex-row sm:items-center sm:justify-end sm:px-6 lg:-mx-8 lg:px-8',
            )}
            data-testid="form-employee-actions"
          >
            {mode === 'edit' && showNoChangesHint && !isDirty && (
              <p className="text-body-sm text-foreground-muted sm:mr-auto" data-testid="text-no-changes">
                No changes to save.
              </p>
            )}
            {mode === 'create' && (
              <p className="text-body-sm text-foreground-muted sm:mr-auto" data-testid="text-no-account-created">
                Registering creates the HR record only. No login account is created or invited.
              </p>
            )}
            <Button type="button" variant="outline" onClick={handleCancel} disabled={isPending} data-testid="button-cancel-employee">
              Cancel
            </Button>
            <Button
              type="submit"
              loading={isPending}
              disabled={isPending || (mode === 'edit' && !isDirty)}
              data-testid="button-submit-employee"
            >
              {submitLabel}
            </Button>
          </div>
        </div>
      </form>

      <ConfirmActionDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard unsaved changes?"
        description="The details you entered on this form have not been saved and will be lost."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        tone="destructive"
        onConfirm={() => {
          setConfirmDiscard(false);
          // The person already confirmed here; the route guard must not ask again.
          releaseNavigationGuard();
          onCancel();
        }}
        testId="dialog-discard-employee-changes"
      />

      {/* Every other way out — sidebar, breadcrumbs, header links, browser
          back/forward, programmatic navigation, tab close — while dirty. */}
      <NavigationGuard when={isDirty} />
    </Form>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function FormSection({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  const headingId = `employee-form-${id}-title`;
  return (
    <section id={`employee-form-${id}`} aria-labelledby={headingId} className="space-y-4 scroll-mt-24" data-testid={`section-employee-${id}`}>
      <SectionHeader title={<span id={headingId}>{title}</span>} description={description} as="h2" />
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/**
 * Wraps sensitive fields with the explanation that matches the caller's rights:
 * hidden entirely when redacted, read-only with a lock when viewable but not
 * changeable, plain when fully editable.
 */
function SensitiveGroup({
  visible,
  editable,
  mode,
  compact = false,
  children,
}: {
  visible: boolean;
  editable: boolean;
  mode: 'create' | 'edit';
  compact?: boolean;
  children: ReactNode;
}) {
  if (!visible) {
    return (
      <p className="sm:col-span-2 flex items-start gap-2 rounded-md border border-border bg-surface-muted p-3 text-body-sm text-foreground-muted" data-testid="text-sensitive-redacted">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        Personal identity and contact details are withheld from your view. They stay exactly as recorded; viewing or changing them needs the sensitive-read and sensitive-write permissions.
      </p>
    );
  }
  return (
    <>
      {!editable && (
        <p
          className={cn('sm:col-span-2 flex items-start gap-2 rounded-md border border-border bg-surface-muted p-3 text-body-sm text-foreground-muted', compact && 'mt-2')}
          data-testid="text-sensitive-readonly"
        >
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {mode === 'create'
            ? 'Personal identity and contact details need the sensitive-write permission. You can register the employee without them; an authorized officer can add them afterwards.'
            : 'You can view these personal details but changing them needs the sensitive-write permission. Your other changes will still be saved.'}
        </p>
      )}
      {children}
    </>
  );
}

function testIdFor(name: string): string {
  return `input-employee-${name.replace(/\./g, '-').replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

function TextField({
  name,
  label,
  required = false,
  type = 'text',
  description,
  disabled = false,
  className,
  autoComplete,
  inputMode,
}: {
  name: FieldPath<EmployeeFormValues>;
  label: string;
  required?: boolean;
  type?: 'text' | 'email' | 'tel' | 'date';
  description?: string;
  disabled?: boolean;
  className?: string;
  autoComplete?: string;
  inputMode?: 'email' | 'tel' | 'text';
}) {
  const { control } = useFormContext<EmployeeFormValues>();
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>
            {label}
            {required && (
              <span aria-hidden="true" className="ml-0.5 text-danger">
                *
              </span>
            )}
          </FormLabel>
          <FormControl>
            <Input
              type={type}
              {...field}
              value={typeof field.value === 'string' ? field.value : ''}
              disabled={disabled}
              aria-required={required || undefined}
              autoComplete={autoComplete}
              inputMode={inputMode}
              data-testid={testIdFor(name)}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function SelectField({
  name,
  label,
  options,
  disabled = false,
  className,
}: {
  name: FieldPath<EmployeeFormValues>;
  label: string;
  options: readonly { value: string; label: string }[];
  disabled?: boolean;
  className?: string;
}) {
  const { control } = useFormContext<EmployeeFormValues>();
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <Select
            value={typeof field.value === 'string' && field.value !== '' ? field.value : NONE}
            onValueChange={(v) => field.onChange(v === NONE ? '' : v)}
            disabled={disabled}
          >
            <FormControl>
              <SelectTrigger data-testid={`select-employee-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`}>
                <SelectValue placeholder="Not specified" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value={NONE}>Not specified</SelectItem>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function LookupSelectField({
  name,
  label,
  items,
  noneLabel,
}: {
  name: 'departmentId' | 'branchId' | 'positionId';
  label: string;
  items: { id: number; name: string }[];
  noneLabel: string;
}) {
  const { control } = useFormContext<EmployeeFormValues>();
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select value={field.value === '' ? NONE : field.value} onValueChange={(v) => field.onChange(v === NONE ? '' : v)}>
            <FormControl>
              <SelectTrigger data-testid={`select-employee-${name.replace(/Id$/, '')}`}>
                <SelectValue placeholder={noneLabel} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value={NONE}>{noneLabel}</SelectItem>
              {items.map((item) => (
                <SelectItem key={item.id} value={String(item.id)}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function EmergencyContactsFields({ disabled }: { disabled: boolean }) {
  const { control } = useFormContext<EmployeeFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: 'emergencyContacts' });
  return (
    <div className="sm:col-span-2 space-y-4" data-testid="list-emergency-contacts">
      {fields.length === 0 && (
        <p className="text-body-sm text-foreground-muted" data-testid="text-no-emergency-contacts">
          No emergency contact recorded.
        </p>
      )}
      {fields.map((row, index) => (
        <fieldset key={row.id} className="grid gap-4 rounded-md border border-border p-4 sm:grid-cols-[1fr_1fr_1fr_auto]" data-testid={`emergency-contact-${index}`}>
          <legend className="px-1 text-label text-foreground">Contact {index + 1}</legend>
          <TextField name={`emergencyContacts.${index}.name`} label="Name" required disabled={disabled} />
          <TextField name={`emergencyContacts.${index}.relationship`} label="Relationship" required disabled={disabled} />
          <TextField name={`emergencyContacts.${index}.phone`} label="Phone" required type="tel" inputMode="tel" disabled={disabled} />
          {!disabled && (
            <div className="flex items-end">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove contact ${index + 1}`}
                onClick={() => remove(index)}
                data-testid={`button-remove-emergency-contact-${index}`}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          )}
        </fieldset>
      ))}
      {!disabled && fields.length < 5 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => append({ name: '', relationship: '', phone: '' })}
          data-testid="button-add-emergency-contact"
        >
          <Plus className="size-4" aria-hidden="true" />
          Add emergency contact
        </Button>
      )}
    </div>
  );
}
