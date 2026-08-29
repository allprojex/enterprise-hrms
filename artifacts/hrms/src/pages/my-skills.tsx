import { useState } from 'react';
import { Award, Plus, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { QueryError } from '@/components/query-error';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMe,
  getGetMeQueryKey,
  useListMySkills,
  getListMySkillsQueryKey,
  useListMySkillOptions,
  getListMySkillOptionsQueryKey,
  useClaimMySkill,
  useGetMySkillGaps,
  getGetMySkillGapsQueryKey,
} from '@workspace/api-client-react';

function errorMessage(err: unknown, fallback: string): string {
  return (
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
    (err instanceof Error ? err.message : fallback)
  );
}

const STATUS: Record<string, { label: string; className: string }> = {
  claimed: { label: 'Awaiting verification', className: 'bg-blue-100 text-blue-900' },
  assessed: { label: 'Assessed', className: 'bg-amber-100 text-amber-900' },
  verified: { label: 'Verified', className: 'bg-green-100 text-green-900' },
  rejected: { label: 'Not accepted', className: 'bg-muted text-muted-foreground' },
};

const GAP_STATE: Record<string, { label: string; className: string }> = {
  no_verified_evidence: { label: 'Not yet verified', className: 'bg-muted text-muted-foreground' },
  below_requirement: { label: 'Below the level required', className: 'bg-amber-100 text-amber-900' },
  meets_requirement: { label: 'Meets the requirement', className: 'bg-green-100 text-green-900' },
  exceeds_requirement: { label: 'Above the level required', className: 'bg-green-100 text-green-900' },
};

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

/**
 * WS-14 — an employee's own capability (§30.26 rows 5 and 6, §30.18).
 *
 * THERE IS NO SUCCESSION CONTENT ON THIS PAGE, AND THERE MUST NEVER BE.
 * §30.17 makes succession confidential: an employee is not shown whether they
 * are a candidate for anything, who else is, or how ready anybody was judged to
 * be. No API this page calls returns any of it, which is the real guarantee —
 * the absence of the route, not the absence of the markup.
 *
 * THE FORM SENDS NO EMPLOYEE IDENTIFIER. The subject is resolved from the
 * caller's own employee link server-side (§30.18), so tampering with the body
 * cannot claim a skill onto somebody else's record. The same is true of the gap
 * view: the position measured is the one on the employee's own record, never a
 * position named by the browser.
 *
 * "NOT YET VERIFIED" IS NOT "CANNOT DO THIS" (§30.6). The wording below is
 * deliberate — an unverified claim means nobody has confirmed it yet, which is
 * frequently because nobody has looked. Presenting it as incapability is the
 * misreading §30.6 forbids.
 */
export default function MySkills() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const enabled = organizationId > 0;

  const [tab, setTab] = useState('skills');
  const [formOpen, setFormOpen] = useState(false);
  const [skillId, setSkillId] = useState('');
  const [levelId, setLevelId] = useState('');
  const [notes, setNotes] = useState('');

  const records = useListMySkills(organizationId, {
    query: { queryKey: getListMySkillsQueryKey(organizationId), enabled },
  });
  const options = useListMySkillOptions(organizationId, {
    query: { queryKey: getListMySkillOptionsQueryKey(organizationId), enabled },
  });
  const gaps = useGetMySkillGaps(organizationId, {
    query: { queryKey: getGetMySkillGapsQueryKey(organizationId), enabled },
  });

  const claim = useClaimMySkill({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Skill recorded', description: 'HR will review it before it counts as verified.' });
        setFormOpen(false);
        setSkillId('');
        setLevelId('');
        setNotes('');
        void queryClient.invalidateQueries({ queryKey: getListMySkillsQueryKey(organizationId) });
      },
      onError: (err: unknown) =>
        toast({ title: 'Could not record', description: errorMessage(err, 'Please try again.'), variant: 'destructive' }),
    },
  });

  const skillsById = new Map((options.data?.skills ?? []).map((s) => [s.id, s]));
  const levelsById = new Map((options.data?.levels ?? []).map((l) => [l.id, l]));
  const selectedSkill = skillId ? skillsById.get(Number(skillId)) : undefined;
  const canSubmit = skillId.length > 0 && !claim.isPending;

  return (
    <div className="space-y-6" data-testid="page-my-skills">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Award className="h-6 w-6" aria-hidden="true" />
          My Skills
        </h1>
        <p className="text-muted-foreground mt-1">
          Record what you can do, and see how it lines up with what your role asks for.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="skills">My skills</TabsTrigger>
          <TabsTrigger value="gaps">My role requirements</TabsTrigger>
        </TabsList>

        <TabsContent value="skills" className="mt-4 space-y-4">
          <Card data-testid="card-claim-skill">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Add a skill</CardTitle>
                  <CardDescription>
                    Anything you add starts as your own claim. It becomes verified only when someone in HR confirms it.
                  </CardDescription>
                </div>
                {!formOpen && (
                  <Button onClick={() => setFormOpen(true)} data-testid="button-open-claim-form">
                    <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
                    Add a skill
                  </Button>
                )}
              </div>
            </CardHeader>
            {formOpen && (
              <CardContent>
                <form
                  className="space-y-4"
                  data-testid="form-claim-skill"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!canSubmit) return;
                    // No employee identifier: the server resolves it from the
                    // caller's own employee link (§30.18).
                    claim.mutate({
                      organizationId,
                      data: {
                        skillId: Number(skillId),
                        ...(levelId ? { claimedLevelId: Number(levelId) } : {}),
                        ...(notes.trim() ? { notes: notes.trim() } : {}),
                      },
                    });
                  }}
                >
                  <div className="space-y-2">
                    <Label htmlFor="my-skill">Skill</Label>
                    <select
                      id="my-skill"
                      className={SELECT_CLASS}
                      value={skillId}
                      onChange={(e) => {
                        setSkillId(e.target.value);
                        setLevelId('');
                      }}
                      data-testid="select-my-skill"
                    >
                      <option value="">Choose a skill</option>
                      {(options.data?.skills ?? []).map((s) => (
                        <option key={s.id} value={String(s.id)}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedSkill?.proficiencyApplicable && (
                    <div className="space-y-2">
                      <Label htmlFor="my-level">How would you describe your level?</Label>
                      <select
                        id="my-level"
                        className={SELECT_CLASS}
                        value={levelId}
                        onChange={(e) => setLevelId(e.target.value)}
                        data-testid="select-my-level"
                      >
                        <option value="">Prefer not to say</option>
                        {(options.data?.levels ?? []).map((l) => (
                          <option key={l.id} value={String(l.id)}>
                            {l.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="my-notes">Anything HR should know (optional)</Label>
                    <Textarea
                      id="my-notes"
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      data-testid="input-my-skill-notes"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={!canSubmit} data-testid="button-submit-claim">
                      {claim.isPending ? 'Saving…' : 'Add skill'}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            )}
          </Card>

          {records.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : records.error ? (
            <QueryError onRetry={() => void records.refetch()} />
          ) : (records.data ?? []).length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground" data-testid="text-no-my-skills">
                You have not recorded any skills yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2" data-testid="list-my-skills">
              {(records.data ?? []).map((r) => {
                const status = STATUS[r.status] ?? { label: r.status, className: 'bg-muted text-muted-foreground' };
                const claimed = r.claimedLevelId ? levelsById.get(r.claimedLevelId) : undefined;
                const verified = r.verifiedLevelId ? levelsById.get(r.verifiedLevelId) : undefined;
                return (
                  <Card key={r.id} data-testid={`row-my-skill-${r.id}`}>
                    <CardContent className="py-4 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <span className="font-medium">{skillsById.get(r.skillId)?.name ?? `Skill #${r.skillId}`}</span>
                        <p className="text-sm text-muted-foreground mt-1">
                          {verified
                            ? `Verified at ${verified.label}`
                            : claimed
                              ? `You said: ${claimed.label}`
                              : 'No level recorded'}
                        </p>
                      </div>
                      <Badge className={status.className}>{status.label}</Badge>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="gaps" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>What my role asks for</CardTitle>
              <CardDescription className="flex items-start gap-2">
                <Info className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  &ldquo;Not yet verified&rdquo; means nobody has confirmed this yet — often simply because nobody has
                  looked. It is not a judgement that you cannot do it.
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              {gaps.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : gaps.error ? (
                <QueryError onRetry={() => void gaps.refetch()} />
              ) : !gaps.data?.positionId ? (
                <p className="py-6 text-center text-muted-foreground" data-testid="text-no-position">
                  You are not currently assigned to a position, so there is nothing to compare against.
                </p>
              ) : (gaps.data.gaps ?? []).length === 0 ? (
                <p className="py-6 text-center text-muted-foreground" data-testid="text-no-my-gaps">
                  Your role has no skill requirements recorded.
                </p>
              ) : (
                <div className="space-y-2" data-testid="list-my-gaps">
                  {(gaps.data.gaps ?? []).map((g) => {
                    const state = GAP_STATE[g.state] ?? { label: g.state, className: 'bg-muted' };
                    return (
                      <div
                        key={g.skillId}
                        className="flex items-center justify-between gap-3 border rounded-md px-3 py-2"
                        data-testid={`row-my-gap-${g.skillId}`}
                      >
                        <div className="min-w-0">
                          <span className="font-medium">{g.skillName}</span>
                          <p className="text-sm text-muted-foreground">
                            {g.requiredLevelLabel ? `Required: ${g.requiredLevelLabel}` : 'Required'}
                            {g.verifiedLevelLabel ? ` · Verified: ${g.verifiedLevelLabel}` : ''}
                            {g.hasUnverifiedClaim && !g.verifiedLevelLabel ? ' · You have recorded this, awaiting verification' : ''}
                            {g.evidenceExpired ? ' · Your certification has expired' : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {g.mandatory && <Badge variant="outline">Required</Badge>}
                          <Badge className={state.className}>{state.label}</Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
