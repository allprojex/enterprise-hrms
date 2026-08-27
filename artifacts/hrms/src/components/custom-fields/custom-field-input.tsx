import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Lock } from 'lucide-react';

/**
 * WS-8 — the single control renderer for one custom field.
 *
 * Everything it renders comes from a server-supplied definition version. It
 * never decides what is valid, required or visible: client validation here is
 * a convenience, and the server re-validates every submission against the
 * definition it holds (see lib/customFields/*). That split is deliberate — a
 * renderer that could relax a rule would be a way around it.
 */

export interface CustomFieldDescriptor {
  definitionId: number;
  fieldKey: string;
  label: string;
  helpText?: string | null;
  fieldType: string;
  required: boolean;
  sensitivity: 'normal' | 'sensitive';
  options?: unknown;
}

interface SelectChoice {
  value: string;
  label: string;
}

function choicesOf(options: unknown): SelectChoice[] {
  const o = options as { choices?: SelectChoice[] } | null;
  return o?.choices ?? [];
}

/** Values are carried as the server's `{ type, value }` envelope; the controls edit the inner value. */
export function innerValue(stored: unknown): unknown {
  if (stored && typeof stored === 'object' && !Array.isArray(stored) && 'value' in (stored as Record<string, unknown>)) {
    return (stored as Record<string, unknown>).value;
  }
  return stored;
}

interface CustomFieldInputProps {
  field: CustomFieldDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  /** True when the value shown is a server-side mask rather than the real one. */
  masked?: boolean;
}

const NONE = '__none__';

export function CustomFieldInput({ field, value, onChange, disabled, masked }: CustomFieldInputProps) {
  const inner = innerValue(value);
  const id = `cf-${field.definitionId}`;

  const control = () => {
    switch (field.fieldType) {
      case 'long_text':
        return (
          <Textarea
            id={id}
            value={typeof inner === 'string' ? inner : ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            rows={4}
          />
        );
      case 'boolean':
        return (
          <div className="flex items-center gap-2">
            <Switch id={id} checked={inner === true} onCheckedChange={(v) => onChange(v)} disabled={disabled} />
            <span className="text-sm text-muted-foreground">{inner === true ? 'Yes' : 'No'}</span>
          </div>
        );
      case 'integer':
      case 'decimal':
        return (
          <Input
            id={id}
            type="number"
            step={field.fieldType === 'integer' ? 1 : 'any'}
            value={inner == null ? '' : String(inner)}
            onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
            disabled={disabled}
          />
        );
      case 'date':
        return (
          <Input
            id={id}
            type="date"
            value={typeof inner === 'string' ? inner.slice(0, 10) : ''}
            onChange={(e) => onChange(e.target.value || null)}
            disabled={disabled}
          />
        );
      case 'datetime':
        return (
          <Input
            id={id}
            type="datetime-local"
            value={typeof inner === 'string' ? inner.slice(0, 16) : ''}
            onChange={(e) => onChange(e.target.value || null)}
            disabled={disabled}
          />
        );
      case 'single_select':
        return (
          <Select value={typeof inner === 'string' && inner ? inner : NONE} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled}>
            <SelectTrigger id={id}>
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Not set</SelectItem>
              {choicesOf(field.options).map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case 'multi_select': {
        const selected = Array.isArray(inner) ? (inner as string[]) : [];
        return (
          <div className="space-y-2 rounded-md border p-3">
            {choicesOf(field.options).map((c) => {
              const checked = selected.includes(c.value);
              return (
                <label key={c.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onChange(checked ? selected.filter((s) => s !== c.value) : [...selected, c.value])}
                  />
                  {c.label}
                </label>
              );
            })}
            {choicesOf(field.options).length === 0 && <p className="text-sm text-muted-foreground">No choices configured.</p>}
          </div>
        );
      }
      case 'employee_reference':
        return (
          <Input
            id={id}
            type="number"
            placeholder="Employee ID"
            value={inner == null ? '' : String(inner)}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
            disabled={disabled}
          />
        );
      case 'master_data_reference':
        return (
          <Input
            id={id}
            placeholder="Master data code"
            value={typeof inner === 'string' ? inner : ''}
            onChange={(e) => onChange(e.target.value || null)}
            disabled={disabled}
          />
        );
      case 'email':
      case 'url':
      case 'phone':
      case 'short_text':
      default:
        return (
          <Input
            id={id}
            type={field.fieldType === 'email' ? 'email' : field.fieldType === 'url' ? 'url' : 'text'}
            value={typeof inner === 'string' ? inner : ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          />
        );
    }
  };

  return (
    <div className="space-y-1.5" data-testid={`custom-field-${field.fieldKey}`}>
      <Label htmlFor={id} className="flex items-center gap-2">
        {field.label}
        {field.required && <span aria-hidden="true">*</span>}
        {field.sensitivity === 'sensitive' && (
          <Badge variant="secondary" className="gap-1">
            <Lock className="h-3 w-3" aria-hidden="true" />
            Sensitive
          </Badge>
        )}
      </Label>
      {control()}
      {masked && <p className="text-xs text-muted-foreground">This value is hidden. You need permission to reveal it.</p>}
      {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
    </div>
  );
}
