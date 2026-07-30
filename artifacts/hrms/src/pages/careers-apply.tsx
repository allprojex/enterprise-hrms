import { useState } from 'react';
import { useParams, Link } from 'wouter';
import { ArrowLeft, CheckCircle2, Upload } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useGetPublicCareersOrganization,
  getGetPublicCareersOrganizationQueryKey,
  useGetPublicVacancy,
  getGetPublicVacancyQueryKey,
  useApplyToPublicVacancy,
} from '@workspace/api-client-react';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

// Application-entry shell (Phase 3A, W49). Resolves the organization and
// vacancy again server-side on submit (the API independently re-checks
// eligibility — this page never trusts that a stale client-side render was
// still accurate). Persistence happens here (candidates/applications/
// consent/document, per the frozen plan's full W49 scope) — this is not a
// no-op shell; the confirmation below reflects a real, saved submission.
export default function CareersApply() {
  const { orgSlug = '', vacancyPublicId = '' } = useParams<{ orgSlug: string; vacancyPublicId: string }>();

  const { data: org } = useGetPublicCareersOrganization(orgSlug, {
    query: { queryKey: getGetPublicCareersOrganizationQueryKey(orgSlug), enabled: !!orgSlug },
  });
  const { data: vacancy, isLoading, error } = useGetPublicVacancy(orgSlug, vacancyPublicId, {
    query: { queryKey: getGetPublicVacancyQueryKey(orgSlug, vacancyPublicId), enabled: !!orgSlug && !!vacancyPublicId },
  });

  const applyMutation = useApplyToPublicVacancy();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [resume, setResume] = useState<File | null>(null);
  const [consented, setConsented] = useState(false);
  // Honeypot: rendered but visually hidden and skipped from tab order — a
  // real applicant never sees or fills it (§6). Left blank by every
  // genuine submission.
  const [website, setWebsite] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !resume || !consented) return;
    applyMutation.mutate(
      {
        orgSlug,
        vacancyPublicId,
        data: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          resume,
          website: website || undefined,
        },
      },
      { onSuccess: () => setSubmitted(true) },
    );
  };

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center space-y-4" role="alert">
          <h1 className="text-2xl font-bold text-foreground">This position isn't accepting applications</h1>
          <p className="text-muted-foreground">It may have closed, been paused, or the link is incorrect.</p>
          <Link href={`/careers/${orgSlug}`} className="text-primary hover:underline inline-flex items-center gap-1" data-testid="link-back-to-careers">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to open positions
          </Link>
        </div>
      </main>
    );
  }

  if (isLoading || !vacancy) {
    return (
      <main className="min-h-screen p-6 lg:p-12 space-y-6 max-w-xl mx-auto">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </main>
    );
  }

  if (submitted) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-md" data-testid="text-application-confirmed">
          <CheckCircle2 className="h-12 w-12 text-primary mx-auto" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-foreground">Application submitted</h1>
          <p className="text-muted-foreground">
            Thanks for applying to <strong>{vacancy.title}</strong>{org ? ` at ${org.name}` : ''}. We've emailed you a link to check your application status.
          </p>
          <Link href={`/careers/${orgSlug}`} className="text-primary hover:underline inline-flex items-center gap-1" data-testid="link-back-to-careers">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to open positions
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-xl mx-auto px-6 py-8 space-y-6">
        <Link href={`/careers/${orgSlug}/jobs/${vacancyPublicId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-to-vacancy">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to {vacancy.title}
        </Link>

        <div>
          <h1 className="text-2xl font-bold text-foreground">Apply for {vacancy.title}</h1>
          {org && <p className="text-muted-foreground">{org.name}</p>}
        </div>

        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Honeypot -- visually hidden, never tabbable, empty by every real applicant. */}
              <div aria-hidden="true" className="absolute -left-[9999px] w-px h-px overflow-hidden">
                <label htmlFor="website">Website</label>
                <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="apply-first-name">First name *</Label>
                  <Input id="apply-first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required data-testid="input-first-name" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apply-last-name">Last name *</Label>
                  <Input id="apply-last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} required data-testid="input-last-name" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="apply-email">Email *</Label>
                <Input id="apply-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="input-email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="apply-phone">Phone</Label>
                <Input id="apply-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="input-phone" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="apply-resume">Resume / CV *</Label>
                <div className="flex items-center gap-2">
                  <Upload className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <input
                    id="apply-resume"
                    type="file"
                    accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                    required
                    onChange={(e) => setResume(e.target.files?.[0] ?? null)}
                    data-testid="input-resume"
                    className="text-sm"
                  />
                </div>
                <p className="text-xs text-muted-foreground">PDF, JPEG, PNG, DOCX, or XLSX — up to 10MB.</p>
              </div>
              <div className="flex items-start gap-2">
                <Checkbox id="apply-consent" checked={consented} onCheckedChange={(v) => setConsented(!!v)} data-testid="checkbox-consent" />
                <Label htmlFor="apply-consent" className="text-sm font-normal leading-snug">
                  I consent to {org?.name ?? 'this organization'} processing my personal data and uploaded documents for the purpose of evaluating this application. *
                </Label>
              </div>

              {applyMutation.isError && (
                <p role="alert" className="text-sm text-destructive">{errorMessage(applyMutation.error) ?? 'Could not submit your application. Please try again.'}</p>
              )}

              <Button type="submit" className="w-full" disabled={applyMutation.isPending || !firstName.trim() || !lastName.trim() || !email.trim() || !resume || !consented} data-testid="button-submit-application">
                {applyMutation.isPending ? 'Submitting…' : 'Submit Application'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
