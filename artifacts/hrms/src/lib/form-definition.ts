/**
 * WS-26 — the template definition contract as the browser sees it.
 *
 * Mirrors artifacts/api-server/src/lib/formEngine/definition.ts (the server
 * is authoritative and validates every definition; the client only renders
 * what it is given). Kept as types plus small pure helpers so the renderer,
 * pages and tests share one vocabulary.
 */
export type FormFieldType = 'short_text' | 'long_text' | 'date' | 'number' | 'phone' | 'email' | 'boolean' | 'single_choice' | 'multi_choice';
export type FormParticipant = 'employee' | 'supervisor' | 'department_head' | 'hr' | 'final_approver' | 'assessor';

export interface FormOption {
  value: string;
  label: string;
}

export interface FormBinding {
  source: string;
  ref: string;
  mode: 'readonly' | 'prefill';
}

export interface FieldItem {
  kind: 'field';
  key: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  options?: FormOption[];
  binding?: FormBinding;
  helpText?: string;
  width?: 'full' | 'half' | 'third';
}

export interface ChoiceGroupItem {
  kind: 'choice_group';
  key: string;
  label?: string;
  mode: 'single' | 'multi';
  options: FormOption[];
  otherField?: { key: string; label: string; requiredWhenValue?: string };
  exclusivePairs?: [string, string][];
  columns?: number;
  required?: boolean;
}

export interface RatingColumn {
  value: number;
  label: string;
}

export interface MatrixRow {
  key: string;
  label: string;
  rated?: boolean;
  repeatHeaderBefore?: boolean;
}

export interface MatrixItem {
  kind: 'matrix';
  key: string;
  label?: string;
  criteriaHeader?: string;
  ratingHeader?: string;
  scaleText?: string;
  columns: RatingColumn[];
  rows: MatrixRow[];
  total?: { key: string; label: string };
  required?: boolean;
}

export interface RatedTableItem {
  kind: 'rated_table';
  key: string;
  label?: string;
  textColumns: { key: string; label: string; type: 'short_text' | 'long_text' }[];
  ratingHeader: string;
  ratingColumns: RatingColumn[];
  rows: { key: string; label: string }[];
  printedLinesPerRow?: number;
  total?: { key: string; label: string };
  required?: boolean;
}

export interface TableItem {
  kind: 'table';
  key: string;
  label?: string;
  columns: { key: string; label: string; type: 'short_text' | 'long_text' | 'date' }[];
  minRows?: number;
  printedRows?: number;
  required?: boolean;
}

export interface NoteItem {
  kind: 'note';
  text: string;
  style?: 'instruction' | 'note' | 'declaration' | 'plain';
}

export interface SignatureSlotItem {
  kind: 'signature';
  key: string;
  label: string;
  role: FormParticipant;
  dateLabel?: string;
  required?: boolean;
}

export interface ComputedItem {
  kind: 'computed';
  key: string;
  label: string;
  op: 'sum';
  of: string[];
}

export type FormItem = FieldItem | ChoiceGroupItem | MatrixItem | RatedTableItem | TableItem | NoteItem | SignatureSlotItem | ComputedItem;

export interface FormSection {
  key: string;
  title?: string;
  layout: 'key_value' | 'grid' | 'stack';
  items: FormItem[];
  editableBy?: FormParticipant[];
}

export interface FormDefinition {
  header: { lines: string[]; logo: 'organization' | 'none' };
  intro?: string[];
  sections: FormSection[];
  footerNotes?: string[];
}

export type Answers = Record<string, unknown>;

export function isFormDefinition(value: unknown): value is FormDefinition {
  return Boolean(value) && typeof value === 'object' && Array.isArray((value as FormDefinition).sections) && Boolean((value as FormDefinition).header);
}

/** Human label for a submission status (the vocabulary the platform uses everywhere). */
export const FORM_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  pending_approval: 'Pending approval',
  returned: 'Returned for correction',
  rejected: 'Rejected',
  resubmitted: 'Resubmitted',
  approved: 'Approved',
  finalized: 'Finalized',
  archived: 'Archived',
};

export const FORM_EVENT_LABEL: Record<string, string> = {
  created: 'Created',
  draft_saved: 'Draft saved',
  submitted: 'Submitted',
  stage_completed: 'Stage completed',
  returned: 'Returned for correction',
  rejected: 'Rejected',
  resubmitted: 'Resubmitted',
  approved: 'Approved',
  signature_applied: 'Signature applied',
  signature_revoked: 'Signature revoked',
  final_document_generated: 'Final document generated',
  finalized: 'Finalized',
  archived: 'Archived',
  downloaded: 'Downloaded',
};
