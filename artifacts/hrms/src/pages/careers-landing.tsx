import { useState } from 'react';
import { useParams, Link } from 'wouter';
import { Building2, Briefcase, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  useGetPublicCareersOrganization,
  getGetPublicCareersOrganizationQueryKey,
  useListPublicVacancies,
  getListPublicVacanciesQueryKey,
  type ListPublicVacanciesParams,
} from '@workspace/api-client-react';
import { QueryError } from '@/components/query-error';

// Public Careers Portal (Phase 3A, W49) — no <AppShell>, no auth, a
// distinct minimal layout mirroring reset-password.tsx/invite-accept.tsx's
// existing standalone-page precedent. Never rendered inside <SecureRoute>.
export default function CareersLanding() {
  const { orgSlug = '' } = useParams<{ orgSlug: string }>();

  const [search, setSearch] = useState('');
  const [employmentType, setEmploymentType] = useState('');
  const [workplaceType, setWorkplaceType] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data: org, isLoading: orgLoading, error: orgError } = useGetPublicCareersOrganization(orgSlug, {
    query: { queryKey: getGetPublicCareersOrganizationQueryKey(orgSlug), enabled: !!orgSlug },
  });

  const params: ListPublicVacanciesParams = {
    search: search || undefined,
    employmentType: employmentType || undefined,
    workplaceType: workplaceType || undefined,
    page,
    pageSize,
  };
  const {
    data: result,
    isLoading: vacanciesLoading,
    error: vacanciesError,
    refetch,
  } = useListPublicVacancies(orgSlug, params, {
    query: { queryKey: getListPublicVacanciesQueryKey(orgSlug, params), enabled: !!org },
  });

  if (orgError) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center space-y-2" role="alert">
          <h1 className="text-2xl font-bold text-foreground">Careers page not available</h1>
          <p className="text-muted-foreground">This organization's careers page could not be found.</p>
        </div>
      </main>
    );
  }

  if (orgLoading || !org) {
    return (
      <main className="min-h-screen p-6 lg:p-12 space-y-8">
        <Skeleton className="h-16 w-64" />
        <Skeleton className="h-96 w-full" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-5xl mx-auto px-6 py-8 flex items-center gap-4">
          {org.logoUrl ? (
            <img src={org.logoUrl} alt={`${org.name} logo`} className="h-14 w-14 rounded-lg object-contain" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10">
              <Building2 className="h-7 w-7 text-primary" aria-hidden="true" />
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold text-foreground" data-testid="text-org-name">{org.name}</h1>
            <p className="text-muted-foreground">Open positions</p>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <form
          className="flex flex-wrap gap-3"
          role="search"
          aria-label="Search open positions"
          onSubmit={(e) => { e.preventDefault(); setPage(1); }}
        >
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              className="pl-9"
              placeholder="Search positions…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              aria-label="Search positions"
              data-testid="input-careers-search"
            />
          </div>
          <select
            className="border border-input rounded-md px-3 text-sm bg-background"
            value={employmentType}
            onChange={(e) => { setEmploymentType(e.target.value); setPage(1); }}
            aria-label="Filter by employment type"
            data-testid="select-employment-type"
          >
            <option value="">All employment types</option>
            <option value="full_time">Full time</option>
            <option value="part_time">Part time</option>
            <option value="contract">Contract</option>
            <option value="intern">Intern</option>
            <option value="temporary">Temporary</option>
          </select>
          <select
            className="border border-input rounded-md px-3 text-sm bg-background"
            value={workplaceType}
            onChange={(e) => { setWorkplaceType(e.target.value); setPage(1); }}
            aria-label="Filter by workplace type"
            data-testid="select-workplace-type"
          >
            <option value="">All workplace types</option>
            <option value="onsite">Onsite</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </form>

        {vacanciesError ? (
          <QueryError title="Could not load open positions" onRetry={() => refetch()} />
        ) : vacanciesLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : !result || result.items.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
                <Briefcase className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-2">No open positions right now</h2>
              <p className="text-sm text-muted-foreground max-w-sm">Check back soon — new opportunities are posted regularly.</p>
            </CardContent>
          </Card>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2" aria-label="Open positions">
            {result.items.map((vacancy) => (
              <li key={vacancy.publicId}>
                <Link
                  href={`/careers/${orgSlug}/jobs/${vacancy.publicId}`}
                  data-testid={`link-vacancy-${vacancy.publicId}`}
                  className="block h-full"
                >
                  <Card className="h-full hover:border-primary transition-colors">
                    <CardContent className="pt-6 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-foreground">{vacancy.title}</h3>
                        {vacancy.featured && <Badge variant="secondary">Featured</Badge>}
                      </div>
                      {vacancy.departmentName && <p className="text-sm text-muted-foreground">{vacancy.departmentName}</p>}
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {vacancy.locations.map((loc) => (
                          <span key={loc} className="rounded-full bg-muted px-2 py-0.5">{loc}</span>
                        ))}
                        {vacancy.employmentType && <span className="rounded-full bg-muted px-2 py-0.5 capitalize">{vacancy.employmentType.replace('_', ' ')}</span>}
                        {vacancy.workplaceType && <span className="rounded-full bg-muted px-2 py-0.5 capitalize">{vacancy.workplaceType}</span>}
                      </div>
                      {vacancy.summary && <p className="text-sm text-muted-foreground line-clamp-2">{vacancy.summary}</p>}
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {result && result.total > pageSize && (
          <div className="flex items-center justify-between pt-2">
            <p className="text-sm text-muted-foreground">Page {page} of {Math.ceil(result.total / pageSize)}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid="button-prev-page">Previous</Button>
              <Button size="sm" variant="outline" disabled={page * pageSize >= result.total} onClick={() => setPage((p) => p + 1)} data-testid="button-next-page">Next</Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
