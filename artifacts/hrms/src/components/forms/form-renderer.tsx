import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { SignatureSlotContext } from '@/components/signature/signature-slot-context';
import { SignatureField } from '@/components/signature/signature-field';
import type {
  Answers,
  ChoiceGroupItem,
  FieldItem,
  FormDefinition,
  FormItem,
  FormSection,
  MatrixItem,
  RatedTableItem,
  SignatureSlotItem,
  TableItem,
} from '@/lib/form-definition';

/**
 * FormRenderer (WS-26).
 *
 * Renders a server-validated template definition as a responsive, accessible
 * form. The official wording is printed exactly as defined; only the
 * presentation adapts to the screen (rating matrices scroll inside their own
 * container on narrow screens, grids collapse to one column). Sections that
 * the current actor may not edit are shown read-only with their values.
 *
 * Signature slots render as labelled placeholders in WS-26A; capture arrives
 * with the signature engine (WS-26B).
 */
export interface FormRendererProps {
  definition: FormDefinition;
  answers: Answers;
  autofill: Record<string, unknown>;
  computed: Record<string, number | null | undefined>;
  /** Section keys the current actor may change; everything else is read-only. */
  editableSectionKeys: readonly string[];
  disabled?: boolean;
  onChange: (key: string, value: unknown) => void;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function widthClass(width: FieldItem['width']): string {
  switch (width) {
    case 'third':
      return 'lg:col-span-2';
    case 'half':
      return 'lg:col-span-3';
    default:
      return 'lg:col-span-6';
  }
}

function displayValue(item: FieldItem, value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map((v) => item.options?.find((o) => o.value === v)?.label ?? String(v)).join(', ');
  if (item.options) return item.options.find((o) => o.value === value)?.label ?? String(value);
  return String(value);
}

function FieldControl({ item, value, readOnly, disabled, onChange }: { item: FieldItem; value: unknown; readOnly: boolean; disabled: boolean; onChange: (v: unknown) => void }) {
  const id = `field-${item.key}`;
  const help = item.helpText ? <p className="text-helper text-foreground-muted">{item.helpText}</p> : null;
  const bound = item.binding?.mode === 'readonly';
  if (readOnly || bound) {
    return (
      <div className="space-y-1" data-testid={`field-${item.key}`}>
        <Label htmlFor={id}>{item.label}</Label>
        <Input id={id} value={displayValue(item, value)} readOnly disabled aria-readonly="true" data-testid={`input-${item.key}`} />
        {bound && <p className="text-helper text-foreground-muted">From the employee record</p>}
        {help}
      </div>
    );
  }
  switch (item.type) {
    case 'long_text':
      return (
        <div className="space-y-1" data-testid={`field-${item.key}`}>
          <Label htmlFor={id} required={item.required}>{item.label}</Label>
          <Textarea id={id} rows={4} value={typeof value === 'string' ? value : ''} disabled={disabled} aria-required={item.required || undefined} onChange={(e) => onChange(e.target.value)} data-testid={`input-${item.key}`} />
          {help}
        </div>
      );
    case 'boolean':
      return (
        <div className="flex items-center gap-2" data-testid={`field-${item.key}`}>
          <Checkbox id={id} checked={value === true} disabled={disabled} onCheckedChange={(c) => onChange(c === true)} data-testid={`input-${item.key}`} />
          <Label htmlFor={id}>{item.label}</Label>
        </div>
      );
    case 'single_choice':
      return (
        <div className="space-y-1" data-testid={`field-${item.key}`}>
          <Label htmlFor={id} required={item.required}>{item.label}</Label>
          <Select value={typeof value === 'string' ? value : ''} disabled={disabled} onValueChange={(v) => onChange(v)}>
            <SelectTrigger id={id} data-testid={`input-${item.key}`}>
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            <SelectContent>
              {item.options?.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {help}
        </div>
      );
    case 'multi_choice': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset className="space-y-2" data-testid={`field-${item.key}`}>
          <legend className="text-label text-foreground">{item.label}</legend>
          {item.options?.map((o) => (
            <div key={o.value} className="flex items-center gap-2">
              <Checkbox id={`${id}-${o.value}`} checked={selected.includes(o.value)} disabled={disabled} onCheckedChange={(c) => onChange(c === true ? [...selected, o.value] : selected.filter((v) => v !== o.value))} />
              <Label htmlFor={`${id}-${o.value}`}>{o.label}</Label>
            </div>
          ))}
          {help}
        </fieldset>
      );
    }
    default: {
      const type = item.type === 'date' ? 'date' : item.type === 'number' ? 'number' : item.type === 'email' ? 'email' : item.type === 'phone' ? 'tel' : 'text';
      return (
        <div className="space-y-1" data-testid={`field-${item.key}`}>
          <Label htmlFor={id} required={item.required}>{item.label}</Label>
          <Input
            id={id}
            type={type}
            inputMode={item.type === 'number' ? 'decimal' : undefined}
            value={value === undefined || value === null ? '' : String(value)}
            disabled={disabled}
            aria-required={item.required || undefined}
            onChange={(e) => onChange(item.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)}
            data-testid={`input-${item.key}`}
          />
          {help}
        </div>
      );
    }
  }
}

function ChoiceGroup({ item, answers, readOnly, disabled, onChange }: { item: ChoiceGroupItem; answers: Answers; readOnly: boolean; disabled: boolean; onChange: (key: string, v: unknown) => void }) {
  const value = answers[item.key];
  const selected = item.mode === 'multi' ? (Array.isArray(value) ? (value as string[]) : []) : typeof value === 'string' ? [value] : [];
  const off = disabled || readOnly;
  const cols = Math.min(item.columns ?? 3, 4);
  return (
    <fieldset className="space-y-3" data-testid={`choice-${item.key}`} aria-required={item.required || undefined}>
      {item.label && <legend className="text-label text-foreground">{item.label}</legend>}
      <div className={cn('grid gap-2 sm:grid-cols-2', cols >= 3 && 'lg:grid-cols-3', cols >= 4 && 'xl:grid-cols-4')} role={item.mode === 'single' ? 'radiogroup' : 'group'}>
        {item.options.map((o) => {
          const id = `choice-${item.key}-${o.value}`;
          const checked = selected.includes(o.value);
          return (
            <div key={o.value} className="flex items-center gap-2">
              {item.mode === 'single' ? (
                <input
                  id={id}
                  type="radio"
                  name={`choice-${item.key}`}
                  className="size-4 accent-primary"
                  checked={checked}
                  disabled={off}
                  onChange={() => onChange(item.key, o.value)}
                  data-testid={`option-${item.key}-${o.value}`}
                />
              ) : (
                <Checkbox id={id} checked={checked} disabled={off} onCheckedChange={(c) => onChange(item.key, c === true ? [...selected, o.value] : selected.filter((v) => v !== o.value))} data-testid={`option-${item.key}-${o.value}`} />
              )}
              <Label htmlFor={id}>{o.label}</Label>
            </div>
          );
        })}
      </div>
      {item.otherField && (
        <div className="space-y-1 max-w-xl">
          <Label htmlFor={`field-${item.otherField.key}`}>{item.otherField.label}</Label>
          <Input id={`field-${item.otherField.key}`} value={typeof answers[item.otherField.key] === 'string' ? (answers[item.otherField.key] as string) : ''} disabled={off} onChange={(e) => onChange(item.otherField!.key, e.target.value)} data-testid={`input-${item.otherField.key}`} />
        </div>
      )}
    </fieldset>
  );
}

function RatingRadios({ name, label, columns, value, disabled, onChange }: { name: string; label: string; columns: { value: number; label: string }[]; value: unknown; disabled: boolean; onChange: (v: number) => void }) {
  return (
    <>
      {columns.map((c) => (
        <td key={c.value} className="px-2 py-2 text-center">
          <input type="radio" name={name} className="size-4 accent-primary" aria-label={`${label}: ${c.label}`} checked={value === c.value} disabled={disabled} onChange={() => onChange(c.value)} data-testid={`rating-${name}-${c.value}`} />
        </td>
      ))}
    </>
  );
}

function Matrix({ item, answers, computed, readOnly, disabled, onChange }: { item: MatrixItem; answers: Answers; computed: Record<string, number | null | undefined>; readOnly: boolean; disabled: boolean; onChange: (key: string, v: unknown) => void }) {
  const values = isRecord(answers[item.key]) ? (answers[item.key] as Record<string, unknown>) : {};
  const off = disabled || readOnly;
  const set = (rowKey: string, v: number) => onChange(item.key, { ...values, [rowKey]: v });
  return (
    <div className="space-y-2" data-testid={`matrix-${item.key}`}>
      {item.label && <p className="text-label text-foreground">{item.label}</p>}
      {item.scaleText && <p className="text-body-sm text-foreground-muted">{item.scaleText}</p>}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[560px] text-table">
          <thead className="bg-surface-muted text-table-head">
            <tr>
              <th scope="col" className="px-3 py-2 text-left">{item.criteriaHeader ?? ''}</th>
              {item.columns.map((c) => (
                <th key={c.value} scope="col" className="px-2 py-2 text-center">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {item.rows.map((row) => (
              <tr key={row.key} className="border-t border-border">
                <th scope="row" className="px-3 py-2 text-left font-normal text-foreground">{row.label}</th>
                {row.rated === false ? (
                  <td colSpan={item.columns.length} className="px-2 py-2 text-center text-foreground-subtle">—</td>
                ) : (
                  <RatingRadios name={`${item.key}.${row.key}`} label={row.label} columns={item.columns} value={values[row.key]} disabled={off} onChange={(v) => set(row.key, v)} />
                )}
              </tr>
            ))}
            {item.total && (
              <tr className="border-t border-border bg-surface-muted font-medium">
                <th scope="row" className="px-3 py-2 text-left">{item.total.label}</th>
                <td colSpan={item.columns.length} className="px-2 py-2 text-center tabular-nums" data-testid={`computed-${item.total.key}`}>{computed[item.total.key] ?? ''}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RatedTable({ item, answers, computed, readOnly, disabled, onChange }: { item: RatedTableItem; answers: Answers; computed: Record<string, number | null | undefined>; readOnly: boolean; disabled: boolean; onChange: (key: string, v: unknown) => void }) {
  const values = isRecord(answers[item.key]) ? (answers[item.key] as Record<string, Record<string, unknown>>) : {};
  const off = disabled || readOnly;
  const setRow = (rowKey: string, patch: Record<string, unknown>) => onChange(item.key, { ...values, [rowKey]: { ...(values[rowKey] ?? {}), ...patch } });
  return (
    <div className="space-y-2" data-testid={`rated-table-${item.key}`}>
      {item.label && <p className="text-label text-foreground">{item.label}</p>}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[720px] text-table">
          <thead className="bg-surface-muted text-table-head">
            <tr>
              {item.textColumns.map((c) => (
                <th key={c.key} scope="col" className="px-3 py-2 text-left">{c.label}</th>
              ))}
              <th scope="colgroup" colSpan={item.ratingColumns.length} className="px-2 py-2 text-center">{item.ratingHeader}</th>
            </tr>
            <tr>
              {item.textColumns.map((c) => (
                <th key={c.key} aria-hidden="true" />
              ))}
              {item.ratingColumns.map((c) => (
                <th key={c.value} scope="col" className="px-2 py-1 text-center">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {item.rows.map((row) => {
              const r = values[row.key] ?? {};
              return (
                <tr key={row.key} className="border-t border-border align-top">
                  {item.textColumns.map((c, i) => (
                    <td key={c.key} className="px-3 py-2">
                      {i === 0 && <p className="mb-1 text-label text-foreground">{row.label}</p>}
                      <Textarea rows={2} aria-label={`${row.label} – ${c.label}`} value={typeof r[c.key] === 'string' ? (r[c.key] as string) : ''} disabled={off} onChange={(e) => setRow(row.key, { [c.key]: e.target.value })} data-testid={`input-${item.key}-${row.key}-${c.key}`} />
                    </td>
                  ))}
                  <RatingRadios name={`${item.key}.${row.key}`} label={row.label} columns={item.ratingColumns} value={r.rating} disabled={off} onChange={(v) => setRow(row.key, { rating: v })} />
                </tr>
              );
            })}
            {item.total && (
              <tr className="border-t border-border bg-surface-muted font-medium">
                <th scope="row" colSpan={item.textColumns.length} className="px-3 py-2 text-left">{item.total.label}</th>
                <td colSpan={item.ratingColumns.length} className="px-2 py-2 text-center tabular-nums" data-testid={`computed-${item.total.key}`}>{computed[item.total.key] ?? ''}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RepeatingTable({ item, answers, readOnly, disabled, onChange }: { item: TableItem; answers: Answers; readOnly: boolean; disabled: boolean; onChange: (key: string, v: unknown) => void }) {
  const rows = Array.isArray(answers[item.key]) ? (answers[item.key] as Record<string, string>[]) : [];
  const off = disabled || readOnly;
  const shown = rows.length > 0 ? rows : off ? [] : [{}];
  const update = (i: number, key: string, v: string) => {
    const next = shown.map((r, idx) => (idx === i ? { ...r, [key]: v } : r));
    onChange(item.key, next);
  };
  return (
    <div className="space-y-2" data-testid={`table-${item.key}`}>
      {item.label && <p className="text-label text-foreground">{item.label}</p>}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-table">
          <thead className="bg-surface-muted text-table-head">
            <tr>
              {item.columns.map((c) => (
                <th key={c.key} scope="col" className="px-3 py-2 text-left">{c.label}</th>
              ))}
              {!off && <th scope="col" className="w-12 px-2 py-2"><span className="sr-only">Remove</span></th>}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={item.columns.length} className="px-3 py-3 text-foreground-muted">None recorded</td>
              </tr>
            )}
            {shown.map((row, i) => (
              <tr key={i} className="border-t border-border">
                {item.columns.map((c) => (
                  <td key={c.key} className="px-2 py-1">
                    <Input aria-label={`${c.label} ${i + 1}`} type={c.type === 'date' ? 'date' : 'text'} value={row[c.key] ?? ''} disabled={off} onChange={(e) => update(i, c.key, e.target.value)} data-testid={`input-${item.key}-${i}-${c.key}`} />
                  </td>
                ))}
                {!off && (
                  <td className="px-1 py-1 text-center">
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove row ${i + 1}`} onClick={() => onChange(item.key, shown.filter((_, idx) => idx !== i))}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!off && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange(item.key, [...shown, {}])} data-testid={`button-add-row-${item.key}`}>
          <Plus aria-hidden="true" />
          Add row
        </Button>
      )}
    </div>
  );
}

function SignatureSlot({ item }: { item: SignatureSlotItem }) {
  const ctx = React.useContext(SignatureSlotContext);
  if (ctx) {
    // WS-26B: inside a submission, the slot becomes a live signature field.
    return (
      <div className="grid gap-3 sm:grid-cols-2" data-testid={`signature-${item.key}`}>
        <SignatureField
          organizationId={ctx.organizationId}
          submissionId={ctx.submissionId}
          slotKey={item.key}
          slotLabel={item.label}
          allowedMethods={ctx.allowedMethods(item.key)}
          applied={ctx.applied(item.key)}
          canSign={ctx.canSign(item.key)}
          onChanged={ctx.onChanged}
        />
        {item.dateLabel && (
          <div className="rounded-md border border-dashed border-border-strong bg-surface-muted px-3 py-3">
            <p className="text-label text-foreground">{item.dateLabel}</p>
            <p className="text-helper text-foreground-muted">Recorded when signed.</p>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid={`signature-${item.key}`}>
      <div className="rounded-md border border-dashed border-border-strong bg-surface-muted px-3 py-3">
        <p className="text-label text-foreground">{item.label}</p>
        <p className="text-helper text-foreground-muted">Signature is captured at signing; the placeholder is printed on the form until then.</p>
      </div>
      {item.dateLabel && (
        <div className="rounded-md border border-dashed border-border-strong bg-surface-muted px-3 py-3">
          <p className="text-label text-foreground">{item.dateLabel}</p>
          <p className="text-helper text-foreground-muted">Recorded when signed.</p>
        </div>
      )}
    </div>
  );
}

function ItemView(props: { item: FormItem; answers: Answers; autofill: Record<string, unknown>; computed: Record<string, number | null | undefined>; readOnly: boolean; disabled: boolean; onChange: (key: string, v: unknown) => void }) {
  const { item, answers, autofill, computed, readOnly, disabled, onChange } = props;
  switch (item.kind) {
    case 'field': {
      const bound = item.binding?.mode === 'readonly';
      const value = bound ? autofill[item.key] : (answers[item.key] ?? autofill[item.key]);
      return <FieldControl item={item} value={value} readOnly={readOnly} disabled={disabled} onChange={(v) => onChange(item.key, v)} />;
    }
    case 'choice_group':
      return <ChoiceGroup item={item} answers={answers} readOnly={readOnly} disabled={disabled} onChange={onChange} />;
    case 'matrix':
      return <Matrix item={item} answers={answers} computed={computed} readOnly={readOnly} disabled={disabled} onChange={onChange} />;
    case 'rated_table':
      return <RatedTable item={item} answers={answers} computed={computed} readOnly={readOnly} disabled={disabled} onChange={onChange} />;
    case 'table':
      return <RepeatingTable item={item} answers={answers} readOnly={readOnly} disabled={disabled} onChange={onChange} />;
    case 'note':
      return (
        <p className={cn('text-body', item.style === 'instruction' && 'text-foreground-muted', item.style === 'note' && 'font-medium text-foreground')} data-testid="form-note">
          {item.text}
        </p>
      );
    case 'signature':
      return <SignatureSlot item={item} />;
    case 'computed':
      return (
        <p className="text-body" data-testid={`computed-${item.key}`}>
          <span className="text-foreground-muted">{item.label}: </span>
          <span className="font-semibold tabular-nums">{computed[item.key] ?? ''}</span>
        </p>
      );
  }
}

function SectionView({ section, editable, disabled = false, ...rest }: { section: FormSection; editable: boolean } & Omit<FormRendererProps, 'definition' | 'editableSectionKeys'>) {
  const grid = section.layout === 'grid';
  return (
    <Card data-testid={`section-${section.key}`} data-editable={editable}>
      {section.title && (
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <CardTitle className="text-section" role="heading" aria-level={2}>{section.title}</CardTitle>
          {!editable && <Badge variant="neutral" dot={false}>Read-only</Badge>}
        </CardHeader>
      )}
      <CardContent className={cn(!section.title && 'pt-5 sm:pt-6', grid ? 'grid grid-cols-1 gap-4 lg:grid-cols-6' : 'space-y-4')}>
        {section.items.map((item, i) => (
          <div key={'key' in item ? item.key : `${section.key}-${i}`} className={cn(grid && (item.kind === 'field' ? widthClass(item.width) : 'lg:col-span-6'))}>
            <ItemView item={item} readOnly={!editable} disabled={disabled} {...rest} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function FormRenderer({ definition, answers, autofill, computed, editableSectionKeys, disabled = false, onChange }: FormRendererProps) {
  const editable = React.useMemo(() => new Set(editableSectionKeys), [editableSectionKeys]);
  return (
    <div className="space-y-5" data-testid="form-renderer">
      <div className="space-y-1">
        {definition.header.lines.map((line, i) => (
          <p key={i} className={cn(i === 0 ? 'text-title' : 'text-body-sm text-foreground-muted', 'text-foreground')}>{line}</p>
        ))}
      </div>
      {definition.intro?.map((line, i) => (
        <p key={i} className="text-body text-foreground-muted">{line}</p>
      ))}
      {definition.sections.map((section) => (
        <SectionView key={section.key} section={section} editable={editable.has(section.key)} answers={answers} autofill={autofill} computed={computed} disabled={disabled} onChange={onChange} />
      ))}
      {definition.footerNotes?.map((note, i) => (
        <p key={i} className="rounded-md border border-border bg-surface-muted px-4 py-3 text-body font-medium text-foreground" data-testid="form-footer-note">{note}</p>
      ))}
    </div>
  );
}
