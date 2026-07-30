import { useParams, Link } from 'wouter';
import { ArrowLeft, MapPin, Briefcase, Calendar } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  useGetPublicCareersOrganization,
  getGetPublicCareersOrganizationQueryKey,
  useGetPublicVacancy,
  getGetPublicVacancyQueryKey,
} from '@workspace/api-client-react';

// Public vacancy detail (Phase 3A, W49) — standalone public page, no
// <AppShell>, no auth. Only publication-safe fields ever reach this
// component: the API's PublicVacancyDetail DTO structurally excludes
// requisition linkage, hiring-manager/recruiter identity, salary, and
// every internal ID.
export default function CareersVacancyDetail() {
  const { orgSlug = '', vacancyPublicId = '' } = useParams<{ orgSlug: string; vacancyPublicId: string }>();

  const { data: org } = useGetPublicCareersOrganization(orgSlug, {
    query: { queryKey: getGetPublicCareersOrganizationQueryKey(orgSlug), enabled: !!orgSlug },
  });

  const { data: vacancy, isLoading, error } = useGetPublicVacancy(orgSlug, vacancyPublicId, {
    query: { queryKey: getGetPublicVacancyQueryKey(orgSlug, vacancyPublicId), enabled: !!orgSlug && !!vacancyPublicId },
  });

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center space-y-4" role="alert">
          <h1 className="text-2xl font-bold text-foreground">Job not found</h1>
          <p className="text-muted-foreground">This position may no longer be open, or the link is incorrect.</p>
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
      <main className="min-h-screen p-6 lg:p-12 space-y-6 max-w-3xl mx-auto">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <Link href={`/careers/${orgSlug}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-to-careers">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to open positions
        </Link>

        <div className="space-y-2">
          {org && <p className="text-sm text-muted-foreground" data-testid="text-org-name">{org.name}</p>}
          <h1 className="text-3xl font-bold text-foreground">{vacancy.title}</h1>
          <div className="flex flex-wrap gap-2 items-center text-sm text-muted-foreground">
            {vacancy.departmentName && <Badge variant="outline">{vacancy.departmentName}</Badge>}
            {vacancy.locations.map((loc) => (
              <span key={loc} className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{loc}</span>
            ))}
            {vacancy.employmentType && <span className="inline-flex items-center gap-1 capitalize"><Briefcase className="h-3.5 w-3.5" aria-hidden="true" />{vacancy.employmentType.replace('_', ' ')}</span>}
            {vacancy.closeDate && (
              <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" aria-hidden="true" />Closes {new Date(vacancy.closeDate).toLocaleDateString()}</span>
            )}
          </div>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-6">
            {vacancy.jobDescription && (
              <section>
                <h2 className="text-lg font-semibold text-foreground mb-2">About this role</h2>
                <p className="text-sm text-foreground whitespace-pre-wrap">{vacancy.jobDescription}</p>
              </section>
            )}
            {vacancy.responsibilities && (
              <section>
                <h2 className="text-lg font-semibold text-foreground mb-2">Responsibilities</h2>
                <p className="text-sm text-foreground whitespace-pre-wrap">{vacancy.responsibilities}</p>
              </section>
            )}
            {vacancy.requirements && (
              <section>
                <h2 className="text-lg font-semibold text-foreground mb-2">Requirements</h2>
                <p className="text-sm text-foreground whitespace-pre-wrap">{vacancy.requirements}</p>
              </section>
            )}
            {vacancy.preferredQualifications && (
              <section>
                <h2 className="text-lg font-semibold text-foreground mb-2">Preferred Qualifications</h2>
                <p className="text-sm text-foreground whitespace-pre-wrap">{vacancy.preferredQualifications}</p>
              </section>
            )}
          </CardContent>
        </Card>

        <div>
          <Link href={`/careers/${orgSlug}/jobs/${vacancyPublicId}/apply`} data-testid="link-apply">
            <Button size="lg" data-testid="button-apply">Apply for this position</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
