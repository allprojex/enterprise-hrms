import type { ReactNode } from 'react';
import { Lock, UserCheck, UserX } from 'lucide-react';
import type { Employee } from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/foundation';
import {
  EMPLOYMENT_TYPE_OPTIONS,
  GENDER_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  STATUS_LABEL,
  formatDateOnly,
  labelFor,
} from './employee-form-schema';

/**
 * The employee profile, read-only, organised the way HR thinks about a record:
 * personal details, contact and emergency information, employment details,
 * HR notes, account status.
 *
 * What appears is exactly what the API returned for THIS caller. A record
 * fetched without employee.sensitive.read arrives with
 * `sensitiveFieldsRedacted: true` and the personal fields absent; this view
 * then says so instead of printing blanks, and never reaches for another
 * source (the directory listing, a cached copy) to fill them in. Notes are
 * present only for holders of employee.notes.read, so the section renders
 * only when the server sent them.
 *
 * No internal identifier is shown: the staff number is the only reference an
 * HR officer needs, and it is theirs, not the database's.
 */

export interface EmployeeProfileSectionsProps {
  employee: Employee;
  /** Name and email of the linked login, resolved by the page from the member list. */
  linkedAccountLabel?: string | null;
  /** Rendered in the header of the Personal details card (the Edit control). */
  headerAction?: ReactNode;
}

export function EmployeeProfileSections({ employee, linkedAccountLabel, headerAction }: EmployeeProfileSectionsProps) {
  const redacted = employee.sensitiveFieldsRedacted === true;
  const address = employee.residentialAddress;
  const addressLines = address
    ? [address.line1, address.line2, [address.city, address.state].filter(Boolean).join(', '), [address.postalCode, address.country].filter(Boolean).join(' ')].filter(
        (l) => l && String(l).trim(),
      )
    : [];
  const contacts = employee.emergencyContacts ?? [];
  const fullName = [employee.firstName, employee.middleName, employee.lastName].filter(Boolean).join(' ');

  return (
    <div className="space-y-6" data-testid="employee-profile-sections">
      <Card data-testid="card-personal-details">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Personal details</CardTitle>
              <CardDescription>Identity information held on the HR record</CardDescription>
            </div>
            {headerAction}
          </div>
        </CardHeader>
        <CardContent>
          <Details>
            <Detail label="Full name" value={fullName} />
            <Detail label="Preferred name" value={employee.preferredName} />
            {redacted ? (
              <RedactedNote />
            ) : (
              <>
                <Detail label="Gender" value={labelFor(GENDER_OPTIONS, employee.gender)} />
                <Detail label="Date of birth" value={formatDateOnly(employee.dateOfBirth)} />
                <Detail label="Marital status" value={labelFor(MARITAL_STATUS_OPTIONS, employee.maritalStatus)} />
                <Detail label="Nationality" value={employee.nationality} />
                <Detail label="National ID number" value={employee.nationalId} mono />
                <Detail label="Passport number" value={employee.passportNumber} mono />
              </>
            )}
          </Details>
        </CardContent>
      </Card>

      <Card data-testid="card-contact-details">
        <CardHeader>
          <CardTitle>Contact and emergency information</CardTitle>
          <CardDescription>How to reach the employee, and who to call in an emergency</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Details>
            <Detail label="Work email" value={employee.workEmail} />
            {redacted ? (
              <RedactedNote />
            ) : (
              <>
                <Detail label="Personal email" value={employee.personalEmail} />
                <Detail label="Primary phone" value={employee.phoneNumber} />
                <Detail label="Alternative phone" value={employee.alternatePhoneNumber} />
                <Detail
                  label="Residential address"
                  value={
                    addressLines.length > 0 ? (
                      <span className="whitespace-pre-line">{addressLines.join('\n')}</span>
                    ) : null
                  }
                  wide
                />
              </>
            )}
          </Details>
          {!redacted && (
            <div className="space-y-2">
              <p className="text-label text-foreground">Emergency contacts</p>
              {contacts.length === 0 ? (
                <p className="text-body-sm text-foreground-muted" data-testid="text-no-emergency-contacts">
                  None recorded.
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border" data-testid="list-emergency-contacts">
                  {contacts.map((c, i) => (
                    <li key={`${c.name}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2 text-body-sm">
                      <span className="font-medium text-foreground">{c.name}</span>
                      <span className="text-foreground-muted">{c.relationship}</span>
                      <span className="font-mono text-foreground">{c.phone}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-employment-details">
        <CardHeader>
          <CardTitle>Employment details</CardTitle>
          <CardDescription>Placement, terms and status</CardDescription>
        </CardHeader>
        <CardContent>
          <Details>
            <Detail label="Employee number" value={employee.employeeNumber} mono />
            <Detail label="Status" value={<StatusBadge status={employee.employmentStatus} label={STATUS_LABEL[employee.employmentStatus] ?? employee.employmentStatus} />} />
            <Detail label="Department" value={employee.departmentName} />
            <Detail label="Branch" value={employee.branchName} />
            <Detail label="Position" value={employee.positionName} />
            <Detail label="Reporting manager" value={employee.reportingManagerName} />
            <Detail label="Employment type" value={labelFor(EMPLOYMENT_TYPE_OPTIONS, employee.employmentType)} />
            <Detail label="Work location" value={employee.workLocation} />
            <Detail label="Hire date" value={formatDateOnly(employee.hireDate)} />
            <Detail label="Probation end date" value={formatDateOnly(employee.probationEndDate)} />
            {employee.employmentStatus === 'terminated' && (
              <>
                <Detail label="Separation date" value={formatDateOnly(employee.separationDate)} />
                <Detail label="Separation reason" value={employee.separationReason} />
              </>
            )}
          </Details>
        </CardContent>
      </Card>

      {typeof employee.notes === 'string' && employee.notes.trim() !== '' && (
        <Card data-testid="card-hr-notes">
          <CardHeader>
            <CardTitle>HR notes</CardTitle>
            <CardDescription>Internal. Visible only to holders of the notes permission.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-line text-body-sm text-foreground" data-testid="text-hr-notes">
              {employee.notes}
            </p>
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-account-status">
        <CardHeader>
          <CardTitle>Account status</CardTitle>
          <CardDescription>Whether this HR record is connected to a login</CardDescription>
        </CardHeader>
        <CardContent>
          {employee.linkedApplicationUserId != null ? (
            <div className="flex items-start gap-3">
              <UserCheck className="mt-0.5 size-5 text-success" aria-hidden="true" />
              <div>
                <p className="text-body-sm font-medium text-foreground" data-testid="text-account-linked">
                  Linked to a login account
                </p>
                {linkedAccountLabel && <p className="text-body-sm text-foreground-muted">{linkedAccountLabel}</p>}
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <UserX className="mt-0.5 size-5 text-foreground-muted" aria-hidden="true" />
              <div className="space-y-1">
                <p className="text-body-sm font-medium text-foreground" data-testid="text-account-not-linked">
                  No login account linked
                </p>
                <p className="text-body-sm text-foreground-muted">
                  Employee records never create logins. Linking to an existing member’s account is a separate action in the Overview panel; inviting a new member happens in Administration.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Details({ children }: { children: ReactNode }) {
  return <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">{children}</dl>;
}

function Detail({ label, value, mono = false, wide = false }: { label: string; value: ReactNode | null | undefined; mono?: boolean; wide?: boolean }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-helper text-foreground-muted">{label}</dt>
      <dd className={`mt-0.5 text-body-sm ${empty ? 'text-foreground-muted' : 'text-foreground'} ${mono && !empty ? 'font-mono' : ''}`}>
        {empty ? '—' : value}
      </dd>
    </div>
  );
}

function RedactedNote() {
  return (
    <div className="sm:col-span-2 flex items-start gap-2 rounded-md border border-border bg-surface-muted p-3 text-body-sm text-foreground-muted" data-testid="text-sensitive-redacted">
      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        Personal identity and contact details are withheld from your view.{' '}
        <Badge variant="secondary" className="align-middle">
          Redacted
        </Badge>
      </span>
    </div>
  );
}
