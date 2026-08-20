import { useRef } from 'react';
import { Paperclip, Download, Upload, Loader2, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { getStoredToken } from '@/lib/auth';
import {
  useListLearningEnrollmentEvidence,
  getListLearningEnrollmentEvidenceQueryKey,
  useAddLearningEnrollmentEvidence,
  getDownloadLearningEnrollmentEvidenceUrl,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ACCEPTED_TYPES = 'application/pdf,image/jpeg,image/png,.docx,.xlsx';
const ACCEPTED_TYPES_LABEL = 'PDF, JPEG, PNG, DOCX, or XLSX — up to 10MB';

/**
 * Enrollment Evidence (Phase 3D, W90) — mirrors
 * `performance-evidence.tsx`'s own W82 component almost verbatim (same
 * reused employee_documents storage layer, same authenticated blob
 * download, no public URL). Visible/uploadable to the same own/manager-
 * of-record/instructor-of-record/organization-wide tier as the
 * enrollment itself, at any status — the backend remains the sole source
 * of truth for whether an upload actually succeeds; `canUpload` here is
 * only a UX convenience to avoid showing a control that would just 403.
 */
export function LearningEvidenceSection({
  organizationId,
  enrollmentId,
  canUpload,
}: {
  organizationId: number;
  enrollmentId: number;
  canUpload: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: evidence, isLoading, error } = useListLearningEnrollmentEvidence(organizationId, enrollmentId, {
    query: { queryKey: getListLearningEnrollmentEvidenceQueryKey(organizationId, enrollmentId), enabled: organizationId > 0 && !!enrollmentId },
  });

  const uploadMutation = useAddLearningEnrollmentEvidence();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    uploadMutation.mutate(
      { organizationId, id: enrollmentId, data: { file } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListLearningEnrollmentEvidenceQueryKey(organizationId, enrollmentId) });
          toast({ title: 'Evidence attached' });
        },
        onError: (err) => {
          toast({ title: 'Could not attach evidence', description: errorMessage(err) ?? ACCEPTED_TYPES_LABEL, variant: 'destructive' });
        },
      },
    );
  };

  const handleDownload = async (evidenceId: number, fileName: string) => {
    try {
      const token = getStoredToken();
      const res = await fetch(getDownloadLearningEnrollmentEvidenceUrl(organizationId, enrollmentId, evidenceId), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: 'Could not download evidence', description: 'Please try again.', variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Paperclip className="h-4 w-4" aria-hidden="true" />
              Evidence
            </CardTitle>
            {canUpload && <CardDescription>{ACCEPTED_TYPES_LABEL}</CardDescription>}
          </div>
          {canUpload && (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending}
                data-testid={`button-attach-learning-evidence-${enrollmentId}`}
              >
                {uploadMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="mr-2 h-4 w-4" aria-hidden="true" />}
                Attach evidence
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                className="hidden"
                onChange={handleFileChange}
                aria-label="Attach evidence file"
                data-testid={`input-learning-evidence-file-${enrollmentId}`}
              />
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : error ? (
          <p className="text-sm text-destructive">Could not load evidence.</p>
        ) : !evidence || evidence.length === 0 ? (
          <p className="text-sm text-muted-foreground">No evidence attached yet.</p>
        ) : (
          <ul className="divide-y divide-border" data-testid={`list-learning-evidence-${enrollmentId}`}>
            {evidence.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-4 py-3" data-testid={`row-learning-evidence-${item.id}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{item.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.mimeType} · {formatFileSize(item.fileSize)} · {new Date(item.addedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDownload(item.id, item.fileName)}
                  aria-label={`Download ${item.fileName}`}
                  data-testid={`button-download-learning-evidence-${item.id}`}
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
