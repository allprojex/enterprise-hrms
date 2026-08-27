import { useState } from 'react';
import { UserPlus, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { QueryError } from '@/components/query-error';
import { useToast } from '@/hooks/use-toast';
import {
  useGetMe,
  getGetMeQueryKey,
  useListRecruitmentSources,
  getListRecruitmentSourcesQueryKey,
  useListVacancies,
  getListVacanciesQueryKey,
  useCaptureManualCandidate,
} from '@workspace/api-client-react';

function isForbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 403;
}
function errorMessage(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? (err instanceof Error ? err.message : fallback);
}

/**
 * WS-9 — Authorized manual candidate capture.
 *
 * The path for candidates who did not come through the public careers portal:
 * referrals, walk-ins, agencies, physical notices, direct sourcing. It works
 * against a vacancy that has never been published, which the public path
 * still — correctly — refuses.
 */
export default function ManualCandidateCapture() {
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const enabled = organizationId > 0;

  const [vacancyId, setVacancyId] = useState('');
  const [sourceCode, setSourceCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [capturedAt, setCapturedAt] = useState('');

  const sourcesQuery = useListRecruitmentSources(organizationId, {
    query: { queryKey: getListRecruitmentSourcesQueryKey(organizationId), enabled },
  });
  const vacanciesQuery = useListVacancies(organizationId, undefined, {
    query: { queryKey: getListVacanciesQueryKey(organizationId, undefined), enabled },
  });
  const captureMutation = useCaptureManualCandidate();

  const sources = sourcesQuery.data?.sources ?? [];
  const vacancies = vacanciesQuery.data?.items ?? [];

  const reset = () => {
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
    setCapturedAt('');
  };

  const handleCapture = () => {
    captureMutation.mutate(
      {
        organizationId,
        data: {
          vacancyId: Number(vacancyId),
          sourceCode,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          capturedAt: capturedAt ? new Date(capturedAt).toISOString() : null,
        },
      },
      {
        onSuccess: (result) => {
          reset();
          toast({
            title: 'Candidate captured',
            description: result.reusedExistingCandidate
              ? 'An existing candidate with this email was reused — no duplicate was created.'
              : 'The candidate has entered your recruitment pipeline.',
          });
        },
        onError: (err) => toast({ title: 'Could not capture candidate', description: errorMessage(err, ''), variant: 'destructive' }),
      },
    );
  };

  if (isForbidden(sourcesQuery.error)) {
    return (
      <div className="p-6">
        <QueryError
          title="You do not have access to candidate capture"
          message="Capturing candidates directly requires the candidate management permission."
        />
      </div>
    );
  }

  const noSources = !sourcesQuery.isLoading && sources.length === 0;

  return (
    <div className="space-y-6 p-6" data-testid="page-manual-candidate-capture">
      <div>
        <h1 className="text-2xl font-semibold">Add a Candidate</h1>
        <p className="text-muted-foreground">
          Record someone who reached you outside the careers portal — a referral, a walk-in, an agency introduction or your own direct sourcing.
        </p>
      </div>

      {noSources && (
        <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">No recruitment sources configured yet.</p>
            <p>
              Sources are yours to define under Master Data (domain <span className="font-mono">recruitment_source</span>) — for example referral,
              walk-in, agency or campus. Add at least one before capturing a candidate.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Candidate details</CardTitle>
          <CardDescription>
            The vacancy does not need to be published. Publication controls the public careers portal; how a candidate reached you is recorded
            separately as their source.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="vacancy">Vacancy</Label>
              <Select value={vacancyId} onValueChange={setVacancyId}>
                <SelectTrigger id="vacancy">
                  <SelectValue placeholder="Choose a vacancy" />
                </SelectTrigger>
                <SelectContent>
                  {vacancies.map((v) => (
                    <SelectItem key={v.id} value={String(v.id)}>
                      {v.title}
                      {v.status !== 'published' ? ` — ${v.status}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="source">How did they reach you?</Label>
              <Select value={sourceCode} onValueChange={setSourceCode} disabled={noSources}>
                <SelectTrigger id="source">
                  <SelectValue placeholder="Select a source" />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((s) => (
                    <SelectItem key={s.code} value={s.code}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="first">First name</Label>
              <Input id="first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="last">Last name</Label>
              <Input id="last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="captured">Date received</Label>
              <Input id="captured" type="date" value={capturedAt} onChange={(e) => setCapturedAt(e.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">Leave blank for today.</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleCapture}
              disabled={!vacancyId || !sourceCode || !firstName.trim() || !lastName.trim() || !email.trim() || captureMutation.isPending}
            >
              <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
              Capture candidate
            </Button>
            <Badge variant="secondary">Recorded in the audit trail</Badge>
          </div>

          <p className="text-xs text-muted-foreground">
            A candidate who already exists with this email is reused rather than duplicated, and cannot be added to the same vacancy twice.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
