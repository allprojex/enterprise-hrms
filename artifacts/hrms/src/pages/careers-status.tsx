import { useParams, Link } from 'wouter';
import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useGetPublicApplicationStatus, getGetPublicApplicationStatusQueryKey } from '@workspace/api-client-react';

// Anonymous application status check (Phase 3A, W49) — reached only via the
// signed, time-limited link emailed at submission (§6); never a bare
// email-lookup form, which would let anyone probe arbitrary emails.
export default function CareersStatus() {
  const { orgSlug = '', token = '' } = useParams<{ orgSlug: string; token: string }>();

  const { data, isLoading, error } = useGetPublicApplicationStatus(orgSlug, token, {
    query: { queryKey: getGetPublicApplicationStatusQueryKey(orgSlug, token), enabled: !!orgSlug && !!token },
  });

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 text-center space-y-4">
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : error || !data ? (
            <div role="alert" className="space-y-2" data-testid="text-status-not-found">
              <XCircle className="h-10 w-10 text-destructive mx-auto" aria-hidden="true" />
              <h1 className="text-xl font-bold text-foreground">Status link not found</h1>
              <p className="text-sm text-muted-foreground">This link may have expired or is invalid.</p>
            </div>
          ) : (
            <div className="space-y-2" data-testid="text-status-found">
              <CheckCircle2 className="h-10 w-10 text-primary mx-auto" aria-hidden="true" />
              <h1 className="text-xl font-bold text-foreground">Application {data.status}</h1>
              <p className="text-sm text-muted-foreground">{data.vacancyTitle}</p>
              <p className="text-xs text-muted-foreground">Submitted {new Date(data.submittedAt).toLocaleDateString()}</p>
            </div>
          )}
          <Link href={`/careers/${orgSlug}`} className="text-primary hover:underline inline-flex items-center gap-1 text-sm" data-testid="link-back-to-careers">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to open positions
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
