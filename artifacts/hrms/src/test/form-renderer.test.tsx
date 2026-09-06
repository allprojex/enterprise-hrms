/**
 * WS-26A — FormRenderer: the official wording renders in order, read-only
 * sections and bound fields cannot be edited, rating matrices are accessible
 * radio inputs, and changes flow through onChange keyed by item.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormRenderer } from '@/components/forms/form-renderer';
import type { FormDefinition } from '@/lib/form-definition';

const definition: FormDefinition = {
  header: { logo: 'organization', lines: ['WORLDWIDE WORD MINISTRIES', 'EMPLOYEE LEAVE APPLICATION FORM'] },
  sections: [
    {
      key: 'employee_details',
      title: 'EMPLOYEE DETAILS',
      layout: 'grid',
      items: [
        { kind: 'field', key: 'employee_name', label: 'Employee Name', type: 'short_text', width: 'half', binding: { source: 'employee', ref: 'fullName', mode: 'readonly' } },
        { kind: 'field', key: 'from_date', label: 'From', type: 'date', required: true, width: 'half' },
      ],
    },
    {
      key: 'leave_type',
      title: 'TYPE OF LEAVE REQUESTED',
      layout: 'stack',
      items: [
        {
          kind: 'choice_group',
          key: 'leave_type',
          mode: 'single',
          options: [
            { value: 'annual_leave', label: 'Annual Leave' },
            { value: 'sick_leave', label: 'Sick Leave' },
          ],
          otherField: { key: 'leave_type_other', label: 'Other (specify)' },
        },
      ],
    },
    {
      key: 'ratings',
      title: 'SECTION B- Half-Year Ratings',
      layout: 'stack',
      editableBy: ['assessor'],
      items: [
        {
          kind: 'matrix',
          key: 'half_year_ratings',
          criteriaHeader: 'Criteria',
          columns: [
            { value: 5, label: '5' },
            { value: 4, label: '4' },
          ],
          rows: [
            { key: 'attitude', label: 'Staff attitude towards work: Overall assessment of staff attitude toward work.' },
            { key: 'overall', label: 'Overall Evaluation: Please add appropriate comments below:', rated: false },
          ],
          total: { key: 'half_year_ratings_total', label: 'Total Ratings (Half Year)' },
        },
      ],
    },
    { key: 'declaration', title: 'EMPLOYEE DECLARATION', layout: 'stack', items: [{ kind: 'signature', key: 'employee_signature', label: 'Employee Signature', role: 'employee', dateLabel: 'Date' }] },
  ],
  footerNotes: ['NOTE: Please submit this form at least 7 working days prior to your planned leave date.'],
};

function renderForm(overrides: Partial<React.ComponentProps<typeof FormRenderer>> = {}) {
  const onChange = vi.fn();
  render(
    <FormRenderer
      definition={definition}
      answers={{}}
      autofill={{ employee_name: 'Ama Boateng' }}
      computed={{ half_year_ratings_total: 9 }}
      editableSectionKeys={['employee_details', 'leave_type']}
      onChange={onChange}
      {...overrides}
    />,
  );
  return { onChange };
}

describe('FormRenderer', () => {
  it('prints the official header, section titles, options, criteria and note verbatim and in order', () => {
    renderForm();
    const text = document.body.textContent ?? '';
    const order = [
      'WORLDWIDE WORD MINISTRIES',
      'EMPLOYEE LEAVE APPLICATION FORM',
      'EMPLOYEE DETAILS',
      'Employee Name',
      'From',
      'TYPE OF LEAVE REQUESTED',
      'Annual Leave',
      'Sick Leave',
      'Other (specify)',
      'SECTION B- Half-Year Ratings',
      'Staff attitude towards work',
      'Total Ratings (Half Year)',
      'EMPLOYEE DECLARATION',
      'Employee Signature',
      'NOTE: Please submit this form at least 7 working days',
    ];
    let cursor = 0;
    for (const token of order) {
      const at = text.indexOf(token, cursor);
      expect(at, token).toBeGreaterThanOrEqual(0);
      cursor = at;
    }
  });

  it('shows bound values read-only and marks non-editable sections', () => {
    renderForm();
    const name = screen.getByTestId('input-employee_name') as HTMLInputElement;
    expect(name.value).toBe('Ama Boateng');
    expect(name).toBeDisabled();
    expect(screen.getByText('From the employee record')).toBeInTheDocument();
    const ratings = screen.getByTestId('section-ratings');
    expect(ratings).toHaveAttribute('data-editable', 'false');
    expect(within(ratings).getByText('Read-only')).toBeInTheDocument();
    expect(screen.getByTestId('rating-half_year_ratings.attitude-5')).toBeDisabled();
  });

  it('reports edits keyed by item, including choice groups and the other-specify line', async () => {
    const user = userEvent.setup();
    const { onChange } = renderForm();
    await user.type(screen.getByTestId('input-from_date'), '2026-10-01');
    expect(onChange).toHaveBeenLastCalledWith('from_date', '2026-10-01');
    await user.click(screen.getByTestId('option-leave_type-sick_leave'));
    expect(onChange).toHaveBeenCalledWith('leave_type', 'sick_leave');
    await user.type(screen.getByTestId('input-leave_type_other'), 'Study');
    expect(onChange).toHaveBeenCalledWith('leave_type_other', 'S');
  });

  it('renders a rating matrix as labelled radios with the total and an un-rated comment row', async () => {
    const user = userEvent.setup();
    const { onChange } = renderForm({ editableSectionKeys: ['ratings'] });
    const radio = screen.getByRole('radio', { name: 'Staff attitude towards work: Overall assessment of staff attitude toward work.: 5' });
    await user.click(radio);
    expect(onChange).toHaveBeenCalledWith('half_year_ratings', { attitude: 5 });
    expect(screen.getByTestId('computed-half_year_ratings_total')).toHaveTextContent('9');
    expect(screen.queryByRole('radio', { name: /Overall Evaluation/ })).not.toBeInTheDocument();
  });

  it('shows the signature slot as a placeholder, never as an input', () => {
    renderForm();
    const slot = screen.getByTestId('signature-employee_signature');
    expect(slot).toHaveTextContent('Employee Signature');
    expect(slot).toHaveTextContent('Date');
    expect(within(slot).queryByRole('textbox')).not.toBeInTheDocument();
  });
});
