/**
 * Employee profile sections (Phase 2) — the read-only profile on the detail page.
 *
 * What matters: the view shows exactly what the API returned for this caller,
 * says "redacted" instead of printing blanks when personal fields were
 * withheld, exposes no internal identifier, and states the account status
 * honestly (an employee record is not a login).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { Employee } from '@workspace/api-client-react';
import { EmployeeProfileSections } from '@/components/employees/employee-profile-sections';

const now = '2026-10-01T00:00:00.000Z';

/** Labels that would announce an internal identifier. "National ID number" is a legitimate personal field. */
const IDENTIFIER_LABEL = /\b(employee|organi[sz]ation|internal|record|tenant|user|member(ship)?)\s+(id|uuid)\b/i;

/**
 * Every place in `root` where one of `ids` appears as a whole digit run:
 * each text node and each attribute value is tokenised separately, so
 * adjacent text ("birth10") and other numbers (a date's day, a phone number,
 * "EMP-0042") can neither hide nor imitate an id.
 */
function exposedIdentifiers(root: HTMLElement, ids: number[]): string[] {
  const wanted = new Set(ids.map(String));
  const found: string[] = [];
  const hit = (value: string) => (value.match(/\d+/g) ?? []).find((token) => wanted.has(token));

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    const id = hit(text);
    if (id) found.push(`text "${text}" contains ${id}`);
  }
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const id = hit(attr.value);
      if (id) found.push(`attribute ${attr.name}="${attr.value}" contains ${id}`);
    }
  }
  return found;
}

function employee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 42,
    organizationId: 10,
    employeeNumber: 'EMP-0042',
    firstName: 'Ada',
    middleName: 'King',
    lastName: 'Lovelace',
    preferredName: 'Ada',
    gender: 'female',
    dateOfBirth: '1990-12-10T00:00:00.000Z',
    maritalStatus: 'married',
    nationality: 'Ghanaian',
    nationalId: 'GHA-123-SECRET',
    passportNumber: 'P-777-SECRET',
    personalEmail: 'ada.personal@example.com',
    workEmail: 'ada@wwm.example',
    phoneNumber: '+233 20 000 0000',
    alternatePhoneNumber: null,
    residentialAddress: { line1: '1 Analytical St', city: 'Accra', state: 'Greater Accra', country: 'Ghana' },
    emergencyContacts: [{ name: 'Charles Babbage', relationship: 'Spouse', phone: '+233200000001' }],
    departmentId: 3,
    departmentName: 'Engineering',
    branchName: 'Head Office',
    positionName: 'Analyst',
    reportingManagerId: 9,
    reportingManagerName: 'Grace Hopper',
    employmentType: 'full_time',
    hireDate: '2024-01-15T00:00:00.000Z',
    probationEndDate: null,
    employmentStatus: 'active',
    workLocation: 'Head office',
    notes: 'Internal HR note',
    sensitiveFieldsRedacted: false,
    linkedApplicationUserId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('EmployeeProfileSections', () => {
  it('renders every section with the values the API returned', () => {
    render(<EmployeeProfileSections employee={employee()} />);

    const personal = screen.getByTestId('card-personal-details');
    expect(within(personal).getByText('Ada King Lovelace')).toBeInTheDocument();
    expect(within(personal).getByText('Female')).toBeInTheDocument();
    expect(within(personal).getByText('Married')).toBeInTheDocument();
    expect(within(personal).getByText('GHA-123-SECRET')).toBeInTheDocument();

    const contact = screen.getByTestId('card-contact-details');
    expect(within(contact).getByText('ada@wwm.example')).toBeInTheDocument();
    expect(within(contact).getByText('ada.personal@example.com')).toBeInTheDocument();
    expect(within(contact).getByText(/1 Analytical St/)).toBeInTheDocument();
    const contacts = within(contact).getByTestId('list-emergency-contacts');
    expect(within(contacts).getByText('Charles Babbage')).toBeInTheDocument();
    expect(within(contacts).getByText('Spouse')).toBeInTheDocument();

    const employment = screen.getByTestId('card-employment-details');
    expect(within(employment).getByText('EMP-0042')).toBeInTheDocument();
    expect(within(employment).getByText('Engineering')).toBeInTheDocument();
    expect(within(employment).getByText('Grace Hopper')).toBeInTheDocument();
    expect(within(employment).getByText('Full-time')).toBeInTheDocument();
    expect(within(employment).getByText('Active')).toBeInTheDocument();

    expect(screen.getByTestId('text-hr-notes')).toHaveTextContent('Internal HR note');
  });

  it('says personal fields were withheld instead of printing blanks, and never fills them from elsewhere', () => {
    render(
      <EmployeeProfileSections
        employee={employee({
          sensitiveFieldsRedacted: true,
          gender: undefined,
          dateOfBirth: undefined,
          nationalId: undefined,
          passportNumber: undefined,
          personalEmail: undefined,
          phoneNumber: undefined,
          residentialAddress: undefined,
          emergencyContacts: undefined,
          notes: undefined,
        })}
      />,
    );
    expect(screen.getAllByTestId('text-sensitive-redacted')).toHaveLength(2);
    expect(screen.queryByText('GHA-123-SECRET')).not.toBeInTheDocument();
    expect(screen.queryByText('National ID number')).not.toBeInTheDocument();
    expect(screen.queryByText('Primary phone')).not.toBeInTheDocument();
    expect(screen.queryByTestId('list-emergency-contacts')).not.toBeInTheDocument();
    // Work email is general and still shown.
    expect(screen.getByText('ada@wwm.example')).toBeInTheDocument();
    // No notes card when the API sent none.
    expect(screen.queryByTestId('card-hr-notes')).not.toBeInTheDocument();
  });

  // Internal identifiers must never reach the profile — only the staff number.
  //
  // The previous assertion regex-searched the whole concatenated textContent
  // for the bare id, which matched the "10" of a date rendered as "Dec 10,
  // 1990" under the CI (en-US) locale and passed under en-GH only because
  // "birth10" has no word boundary. The check below is structural instead:
  // every TEXT NODE and every ATTRIBUTE VALUE is tokenised into digit runs,
  // and a token must not EQUAL an internal id. A date's "10", a phone number
  // or "EMP-0042" are different tokens and cannot be mistaken for an id; an
  // id rendered anywhere — as text, in a data-* attribute, in an href — is.
  // Distinctive fixture ids additionally keep a legitimately rendered day or
  // month from ever equalling one.
  describe('exposes no internal identifier — only the staff number', () => {
    const INTERNAL_IDS = { employeeId: 90421, organizationId: 70913, reportingManagerId: 80557, departmentId: 60331 };
    const internal = () =>
      employee({
        id: INTERNAL_IDS.employeeId,
        organizationId: INTERNAL_IDS.organizationId,
        reportingManagerId: INTERNAL_IDS.reportingManagerId,
        departmentId: INTERNAL_IDS.departmentId,
        linkedApplicationUserId: null,
      });

    describe.each([
      { locale: 'en-US', dob: 'Dec 10, 1990' },
      { locale: 'en-GH', dob: '10 Dec 1990' },
    ])('under the $locale locale', ({ locale, dob }) => {
      const original = Date.prototype.toLocaleDateString;
      beforeEach(() => {
        vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (this: Date, locales, options) {
          return original.call(this, locales ?? locale, options);
        });
      });
      afterEach(() => vi.restoreAllMocks());

      it('renders no internal id in any text node or attribute, and no identifier label', () => {
        const { container } = render(<EmployeeProfileSections employee={internal()} />);
        // The locale really applied (proves the date contains a bare day number).
        expect(screen.getByText(dob)).toBeInTheDocument();

        expect(exposedIdentifiers(container, Object.values(INTERNAL_IDS))).toEqual([]);
        expect(container.textContent ?? '').not.toMatch(IDENTIFIER_LABEL);
        // The legitimate business identifier is shown.
        expect(screen.getByText('EMP-0042')).toBeInTheDocument();
      });
    });

    it('the detector catches an id rendered as text, inside a sentence, or in an attribute (negative control)', () => {
      const { container } = render(
        <div>
          <p>EMP-0042</p>
          <p>Born 10 Dec 1990 · +233 20 000 0000</p>
          <span>Record 90421</span>
          <a href="/organizations/70913/employees">open</a>
          <div data-employee-id="90421" />
        </div>,
      );
      expect(exposedIdentifiers(container, Object.values(INTERNAL_IDS))).toEqual([
        'text "Record 90421" contains 90421',
        'attribute href="/organizations/70913/employees" contains 70913',
        'attribute data-employee-id="90421" contains 90421',
      ]);
    });

    it('the label check catches an internal identifier label (negative control)', () => {
      for (const label of ['Employee ID', 'Organisation ID', 'Organization id', 'Internal ID', 'Tenant UUID']) {
        expect(label).toMatch(IDENTIFIER_LABEL);
      }
      for (const label of ['Employee number', 'National ID number', 'Passport number']) {
        expect(label).not.toMatch(IDENTIFIER_LABEL);
      }
    });
  });

  it('states that no login exists and that records never create one', () => {
    render(<EmployeeProfileSections employee={employee({ linkedApplicationUserId: null })} />);
    expect(screen.getByTestId('text-account-not-linked')).toBeInTheDocument();
    expect(screen.getByText(/Employee records never create logins/)).toBeInTheDocument();
  });

  it('shows the linked account label when a login is linked', () => {
    render(<EmployeeProfileSections employee={employee({ linkedApplicationUserId: 7 })} linkedAccountLabel="Ada Lovelace (ada@wwm.example)" />);
    expect(screen.getByTestId('text-account-linked')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace (ada@wwm.example)')).toBeInTheDocument();
  });

  it('shows separation details only for a separated employee and renders the header action', () => {
    render(
      <EmployeeProfileSections
        employee={employee({ employmentStatus: 'terminated', separationDate: '2026-03-31T00:00:00.000Z', separationReason: 'resignation' })}
        headerAction={<button type="button">Edit</button>}
      />,
    );
    expect(screen.getByText('Separation reason')).toBeInTheDocument();
    expect(screen.getByText('resignation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('stacks on narrow screens: two columns only from the sm breakpoint, never a bare multi-column grid', () => {
    const { container } = render(<EmployeeProfileSections employee={employee()} />);
    const grids = Array.from(container.querySelectorAll('dl'));
    expect(grids.length).toBeGreaterThan(0);
    for (const dl of grids) {
      expect(dl.className).toContain('sm:grid-cols-2');
      expect(dl.className).not.toMatch(/(^|\s)grid-cols-[2-9]/);
    }
  });
});
