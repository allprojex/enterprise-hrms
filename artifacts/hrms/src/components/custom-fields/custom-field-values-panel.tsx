import { useState } from 'react';
import { AlertTriangle, Eye, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  useGetCustomFieldValues,
  getGetCustomFieldValuesQueryKey,
  useSetCustomFieldValues,
} from '@workspace/api-client-react';
import { CustomFieldInput, innerValue, type CustomFieldDescriptor } from './custom-field-input';

/**
 * WS-8 — the reusable "Custom Fields" panel for any record page.
 *
 * Every decision is the server's: which fields exist, their order, whether
 * each is currently visible, whether a required one is missing, and whether a
 * sensitive value is masked. This component renders that answer and posts
 * edits back; it deliberately re-fetches after saving rather than trusting its
 * own optimistic view, because a save can change which fields are applicable.
 */
interface CustomFieldValuesPanelProps {
  organizationId: number;
  scope: string;
  entityId: number;
  /** Rendered read-only when the caller cannot edit this record. */
  readOnly?: boolean;
  title?: string;
}

export function CustomFieldValuesPanel({
  organizationId,
  scope,
  entityId,
  readOnly,
  title = 'Custom Fields',
}: CustomFieldValuesPanelProps) {
  const { toast } = useToast();
  const enabled = organizationId > 0 && entityId > 0;

  const query = useGetCustomFieldValues(organizationId, scope, entityId, undefined, {
    query: { queryKey: getGetCustomFieldValuesQueryKey(organizationId, scope, entityId), enabled },
  });
  const mutation = useSetCustomFieldValues();

  const serverValues = query.data?.values ?? [];

  /**
   * `edits` holds ONLY the fields the user has actually touched, overlaid on
   * the server's answer at render time.
   *
   * Deliberately not a mirror of server state seeded by an effect: that shape
   * re-seeds whenever the query result's object identity changes, which turns
   * any non-memoized `data` into an infinite render loop. An overlay needs no
   * effect at all, and it also means a refetch (after saving, or after another
   * user's change) shows through immediately for fields nobody is editing.
   */
  const [edits, setEdits] = useState<Record<number, unknown>>({});
  const dirty = Object.keys(edits).length > 0;

  const valueFor = (definitionId: number, stored: unknown) =>
    Object.prototype.hasOwnProperty.call(edits, definitionId) ? edits[definitionId] : innerValue(stored);

  if (!enabled || query.isLoading) return null;
  // A record type with no configured fields shows nothing rather than an
  // empty card.
  if (serverValues.length === 0) return null;

  const visible = serverValues.filter((v) => v.visible);
  const missingCount = serverValues.filter((v) => v.missingRequired).length;

  const handleSave = () => {
    const payload: Record<string, unknown> = {};
    for (const v of visible) {
      // A masked value is not the real one — sending it back would overwrite
      // the real value with its own mask.
      if (v.masked) continue;
      payload[String(v.definitionId)] = valueFor(v.definitionId, v.value) ?? null;
    }
    mutation.mutate(
      { organizationId, scope, entityId, data: { values: payload } },
      {
        onSuccess: () => {
          // Clearing the overlay hands display back to the server's answer,
          // which may now include different fields: saving can change which
          // conditional fields apply.
          setEdits({});
          void query.refetch();
          toast({ title: 'Custom fields saved' });
        },
        onError: (err: unknown) => {
          const message =
            (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
            (err instanceof Error ? err.message : 'Could not save custom fields');
          toast({ title: 'Could not save', description: message, variant: 'destructive' });
        },
      },
    );
  };

  return (
    <Card data-testid="custom-fields-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {title}
          {missingCount > 0 && (
            <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-900">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              {missingCount} missing required
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Extra information your organization has configured for this record type.
          {query.data?.revealed === false && serverValues.some((v) => v.masked) && ' Sensitive values are hidden.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {visible.map((v) => (
          <div key={v.definitionId}>
            <CustomFieldInput
              field={v as unknown as CustomFieldDescriptor}
              value={valueFor(v.definitionId, v.value)}
              masked={v.masked}
              disabled={readOnly || v.masked || mutation.isPending}
              onChange={(next) => {
                setEdits((prev) => ({ ...prev, [v.definitionId]: next }));
              }}
            />
            {v.missingRequired && (
              <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                Missing required custom data
              </p>
            )}
          </div>
        ))}

        {serverValues.some((v) => v.masked) && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Eye className="h-3 w-3" aria-hidden="true" />
            Revealing a sensitive value is recorded in the audit trail.
          </p>
        )}

        {!readOnly && (
          <Button onClick={handleSave} disabled={!dirty || mutation.isPending}>
            <Save className="mr-2 h-4 w-4" aria-hidden="true" />
            Save custom fields
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
