/**
 * Employee profile sections (Phase 2) — the read-only profile on the detail page.
 *
 * What matters: the view shows exactly what the API returned for this caller,
 * says "redacted" instead of printing blanks when personal fields were
 * withheld, exposes no internal identifier, and states the account status
 * honestly (an employee record is not a login).
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { Employee } from '@workspace/api-client-react';
import { EmployeeProfileSections } from '@/components/employees/employee-profile-sections';

const now = '2026-10-01T00:00:00.000Z';

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

  it('exposes no internal identifier — only the staff number', () => {
    const { container } = render(<EmployeeProfileSections employee={employee()} />);
    expect(container.textContent).not.toMatch(/\b42\b/);
    expect(container.textContent).not.toMatch(/\b10\b/);
    expect(screen.getByText('EMP-0042')).toBeInTheDocument();
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
