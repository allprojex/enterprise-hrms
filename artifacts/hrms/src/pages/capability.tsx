import { useState } from 'react';
import { GraduationCap, ShieldCheck, Target, ListChecks, Plus, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { QueryError } from '@/components/query-error';
import { ConfirmActionDialog } from '@/components/foundation';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMe,
  getGetMeQueryKey,
  useListEmployees,
  getListEmployeesQueryKey,
  useListPositions,
  getListPositionsQueryKey,
  useListSkills,
  getListSkillsQueryKey,
  useGetProficiencyScale,
  getGetProficiencyScaleQueryKey,
  useListEmployeeSkillRecords,
  getListEmployeeSkillRecordsQueryKey,
  useClaimEmployeeSkill,
  useAssessEmployeeSkill,
  useVerifyEmployeeSkill,
  useRejectEmployeeSkill,
  useListPositionSkillRequirements,
  getListPositionSkillRequirementsQueryKey,
  useAddPositionRequirement,
  useRemovePositionRequirement,
  useGetEmployeeSkillGaps,
  getGetEmployeeSkillGapsQueryKey,
  useListDevelopmentActions,
  getListDevelopmentActionsQueryKey,
  useCreateDevelopmentAction,
  useUpdateDevelopmentAction,
} from '@workspace/api-client-react';

function errorMessage(err: unknown, fallback: string): string {
  return (
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
    (err instanceof Error ? err.message : fallback)
  );
}

const STATUS: Record<string, { label: string; className: string }> = {
  claimed: { label: 'Claimed', className: 'bg-blue-100 text-blue-900' },
  assessed: { label: 'Assessed', className: 'bg-amber-100 text-amber-900' },
  verified: { label: 'Verified', className: 'bg-green-100 text-green-900' },
  rejected: { label: 'Rejected', className: 'bg-muted text-muted-foreground' },
};

const GAP_STATE: Record<string, { label: string; className: string }> = {
  no_verified_evidence: { label: 'No verified evidence', className: 'bg-muted text-muted-foreground' },
  below_requirement: { label: 'Below requirement', className: 'bg-amber-100 text-amber-900' },
  meets_requirement: { label: 'Meets requirement', className: 'bg-green-100 text-green-900' },
  exceeds_requirement: { label: 'Exceeds requirement', className: 'bg-green-100 text-green-900' },
};

const ACTION_STATUS = ['open', 'in_progress', 'completed', 'cancelled'] as const;

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

const todayIso = () => new Date().toISOString();

/**
 * WS-14 — the HR capability workspace (§30.26 rows 4, 7, 8, 9, 10 and 14).
 *
 * THE FOUR CONCEPTS §30.5 KEEPS APART ARE KEPT APART HERE TOO. A claim is what
 * somebody says. An assessment is what an assessor observed. A verification is
 * what the organization confirms. A requirement is what a role asks for. This
 * page never collapses them into one control: "Assess" and "Verify" are
 * separate buttons because they are separate acts, and recording an assessment
 * deliberately does not verify anything (§30.8).
 *
 * "NO VERIFIED EVIDENCE" IS NOT "LACKS THE SKILL" (§30.6). The gap view below
 * shows an unverified claim as its own state, alongside the requirement, and
 * never counts it as satisfying one — but it never presents it as incapability
 * either. Frequently it means nobody has looked yet.
 *
 * ADDING A REQUIREMENT BLOCKS NOTHING (§30.9). It makes a gap visible. No
 * employment consequence follows from anything on this page: nobody is moved,
 * suspended or enrolled because a gap exists.
 */
export default function Capability() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const enabled = organizationId > 0;

  const [tab, setTab] = useState('profiles');
  const [employeeId, setEmployeeId] = useState('');
  const [positionId, setPositionId] = useState('');

  const [claimOpen, setClaimOpen] = useState(false);
  const [claimSkillId, setClaimSkillId] = useState('');
  const [claimLevelId, setClaimLevelId] = useState('');

  const [decisionFor, setDecisionFor] = useState<number | null>(null);
  const [decisionLevelId, setDecisionLevelId] = useState('');
  const [decisionNotes, setDecisionNotes] = useState('');

  const [reqSkillId, setReqSkillId] = useState('');
  const [reqLevelId, setReqLevelId] = useState('');
  const [reqMandatory, setReqMandatory] = useState(true);
  const [withdrawTarget, setWithdrawTarget] = useState<{ id: number; skillName: string } | null>(null);

  const [actionOpen, setActionOpen] = useState(false);
  const [actionText, setActionText] = useState('');
  const [actionSkillId, setActionSkillId] = useState('');
  const [actionTarget, setActionTarget] = useState('');

  const employees = useListEmployees(organizationId, undefined, {
    query: { queryKey: getListEmployeesQueryKey(organizationId), enabled },
  });
  const positions = useListPositions(organizationId, {
    query: { queryKey: getListPositionsQueryKey(organizationId), enabled },
  });
  const skills = useListSkills(organizationId, { activeOnly: true }, {
    query: { queryKey: getListSkillsQueryKey(organizationId, { activeOnly: true }), enabled },
  });
  const scale = useGetProficiencyScale(organizationId, {
    query: { queryKey: getGetProficiencyScaleQueryKey(organizationId), enabled },
  });

  const employeeNum = employeeId ? Number(employeeId) : 0;
  const positionNum = positionId ? Number(positionId) : 0;

  const records = useListEmployeeSkillRecords(organizationId, { employeeId: employeeNum }, {
    query: {
      queryKey: getListEmployeeSkillRecordsQueryKey(organizationId, { employeeId: employeeNum }),
      enabled: enabled && employeeNum > 0,
    },
  });
  const requirements = useListPositionSkillRequirements(organizationId, positionNum, {
    query: {
      queryKey: getListPositionSkillRequirementsQueryKey(organizationId, positionNum),
      enabled: enabled && positionNum > 0,
    },
  });
  const gaps = useGetEmployeeSkillGaps(organizationId, employeeNum, { positionId: positionNum }, {
    query: {
      queryKey: getGetEmployeeSkillGapsQueryKey(organizationId, employeeNum, { positionId: positionNum }),
      enabled: enabled && employeeNum > 0 && positionNum > 0,
    },
  });
  const actions = useListDevelopmentActions(organizationId, { employeeId: employeeNum }, {
    query: {
      queryKey: getListDevelopmentActionsQueryKey(organizationId, { employeeId: employeeNum }),
      enabled: enabled && employeeNum > 0,
    },
  });

  const refreshRecords = () => {
    void queryClient.invalidateQueries({
      queryKey: getListEmployeeSkillRecordsQueryKey(organizationId, { employeeId: employeeNum }),
    });
    void queryClient.invalidateQueries({
      queryKey: getGetEmployeeSkillGapsQueryKey(organizationId, employeeNum, { positionId: positionNum }),
    });
  };
  const refreshRequirements = () => {
    void queryClient.invalidateQueries({
      queryKey: getListPositionSkillRequirementsQueryKey(organizationId, positionNum),
    });
    void queryClient.invalidateQueries({
      queryKey: getGetEmployeeSkillGapsQueryKey(organizationId, employeeNum, { positionId: positionNum }),
    });
  };
  const refreshActions = () =>
    void queryClient.invalidateQueries({
      queryKey: getListDevelopmentActionsQueryKey(organizationId, { employeeId: employeeNum }),
    });

  const onError = (title: string) => (err: unknown) =>
    toast({ title, description: errorMessage(err, 'Please try again.'), variant: 'destructive' });

  const clearDecision = () => {
    setDecisionFor(null);
    setDecisionLevelId('');
    setDecisionNotes('');
  };

  const claimSkill = useClaimEmployeeSkill({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Skill recorded', description: 'It is recorded as a claim until it is verified.' });
        setClaimOpen(false);
        setClaimSkillId('');
        setClaimLevelId('');
        refreshRecords();
      },
      onError: onError('Could not record'),
    },
  });

  const assess = useAssessEmployeeSkill({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Assessment recorded', description: 'This is an observation. It does not verify the claim.' });
        clearDecision();
        refreshRecords();
      },
      onError: onError('Could not assess'),
    },
  });

  const verify = useVerifyEmployeeSkill({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Skill verified' });
        clearDecision();
        refreshRecords();
      },
      onError: onError('Could not verify'),
    },
  });

  const reject = useRejectEmployeeSkill({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Claim rejected' });
        clearDecision();
        refreshRecords();
      },
      onError: onError('Could not reject'),
    },
  });

  const addRequirement = useAddPositionRequirement({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Requirement added', description: 'This makes a gap visible. It blocks nothing.' });
        setReqSkillId('');
        setReqLevelId('');
        refreshRequirements();
      },
      onError: onError('Could not add'),
    },
  });

  const removeRequirement = useRemovePositionRequirement({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Requirement withdrawn' });
        refreshRequirements();
      },
      onError: onError('Could not withdraw'),
    },
  });

  const createAction = useCreateDevelopmentAction({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Development action recorded', description: 'Nobody has been enrolled on anything.' });
        setActionOpen(false);
        setActionText('');
        setActionSkillId('');
        setActionTarget('');
        refreshActions();
      },
      onError: onError('Could not record'),
    },
  });

  const updateAction = useUpdateDevelopmentAction({
    mutation: { onSuccess: refreshActions, onError: onError('Could not update') },
  });

  const skillsById = new Map((skills.data ?? []).map((s) => [s.id, s]));
  const levels = scale.data?.levels ?? [];
  const levelsById = new Map(levels.map((l) => [l.id, l]));
  const activeRecord = decisionFor ? (records.data ?? []).find((r) => r.id === decisionFor) : undefined;
  const decisionSkill = activeRecord ? skillsById.get(activeRecord.skillId) : undefined;

  const employeeOptions = employees.data?.items ?? [];

  return (
    <div className="space-y-6" data-testid="page-capability">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <GraduationCap className="h-6 w-6" aria-hidden="true" />
          Capability
        </h1>
        <p className="text-muted-foreground mt-1">
          Employee skills, assessment and verification, what each role requires, and the gaps between them.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="profiles">Skill profiles</TabsTrigger>
          <TabsTrigger value="requirements">Position requirements</TabsTrigger>
          <TabsTrigger value="gaps">Gap analysis</TabsTrigger>
          <TabsTrigger value="development">Development</TabsTrigger>
        </TabsList>

        {/* --- Skill profile, assessment and verification (rows 4, 7, 8) --- */}
        <TabsContent value="profiles" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Choose an employee</CardTitle>
              <CardDescription>Their recorded skills, and the decisions taken on each.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 max-w-md">
                <Label htmlFor="cap-employee">Employee</Label>
                <select
                  id="cap-employee"
                  className={SELECT_CLASS}
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  data-testid="select-capability-employee"
                >
                  <option value="">Choose an employee</option>
                  {employeeOptions.map((e) => (
                    <option key={e.id} value={String(e.id)}>
                      {[e.firstName, e.lastName].filter(Boolean).join(' ') || `Employee #${e.id}`}
                    </option>
                  ))}
                </select>
              </div>

              {employeeNum > 0 && !claimOpen && (
                <Button onClick={() => setClaimOpen(true)} data-testid="button-open-hr-claim">
                  <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
                  Record a skill
                </Button>
              )}

              {employeeNum > 0 && claimOpen && (
                <form
                  className="space-y-4 border rounded-md p-4"
                  data-testid="form-hr-claim"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!claimSkillId) return;
                    claimSkill.mutate({
                      organizationId,
                      employeeId: employeeNum,
                      data: {
                        skillId: Number(claimSkillId),
                        ...(claimLevelId ? { claimedLevelId: Number(claimLevelId) } : {}),
                      },
                    });
                  }}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="claim-skill">Skill</Label>
                      <select
                        id="claim-skill"
                        className={SELECT_CLASS}
                        value={claimSkillId}
                        onChange={(e) => setClaimSkillId(e.target.value)}
                        data-testid="select-claim-skill"
                      >
                        <option value="">Choose a skill</option>
                        {(skills.data ?? []).map((s) => (
                          <option key={s.id} value={String(s.id)}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="claim-level">Level claimed (optional)</Label>
                      <select
                        id="claim-level"
                        className={SELECT_CLASS}
                        value={claimLevelId}
                        onChange={(e) => setClaimLevelId(e.target.value)}
                        data-testid="select-claim-level"
                      >
                        <option value="">Not stated</option>
                        {levels.map((l) => (
                          <option key={l.id} value={String(l.id)}>
                            {l.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    This is recorded as a claim. Verifying it is a separate, deliberate step.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      disabled={!claimSkillId || claimSkill.isPending}
                      data-testid="button-submit-hr-claim"
                    >
                      {claimSkill.isPending ? 'Recording…' : 'Record skill'}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setClaimOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>

          {employeeNum === 0 ? null : records.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : records.error ? (
            <QueryError onRetry={() => void records.refetch()} />
          ) : (records.data ?? []).length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground" data-testid="text-no-records">
                No skills recorded for this employee yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2" data-testid="list-employee-skills">
              {(records.data ?? []).map((r) => {
                const status = STATUS[r.status] ?? { label: r.status, className: 'bg-muted' };
                const open = decisionFor === r.id;
                return (
                  <Card key={r.id} data-testid={`row-record-${r.id}`}>
                    <CardContent className="py-4 space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <span className="font-medium">
                            {skillsById.get(r.skillId)?.name ?? `Skill #${r.skillId}`}
                          </span>
                          <p className="text-sm text-muted-foreground mt-1">
                            {r.claimedLevelId ? `Claimed: ${levelsById.get(r.claimedLevelId)?.label ?? '—'}` : 'No level claimed'}
                            {r.verifiedLevelId ? ` · Verified: ${levelsById.get(r.verifiedLevelId)?.label ?? '—'}` : ''}
                            {` · Source: ${r.source.replace(/_/g, ' ')}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge className={status.className}>{status.label}</Badge>
                          {!open && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setDecisionFor(r.id);
                                setDecisionLevelId(String(r.claimedLevelId ?? ''));
                                setDecisionNotes('');
                              }}
                              data-testid={`button-decide-${r.id}`}
                            >
                              Assess or verify
                            </Button>
                          )}
                        </div>
                      </div>

                      {open && (
                        <div className="border rounded-md p-4 space-y-4" data-testid={`panel-decision-${r.id}`}>
                          {decisionSkill?.proficiencyApplicable && (
                            <div className="space-y-2 max-w-xs">
                              <Label htmlFor={`decision-level-${r.id}`}>Level</Label>
                              <select
                                id={`decision-level-${r.id}`}
                                className={SELECT_CLASS}
                                value={decisionLevelId}
                                onChange={(e) => setDecisionLevelId(e.target.value)}
                                data-testid={`select-decision-level-${r.id}`}
                              >
                                <option value="">Choose a level</option>
                                {levels.map((l) => (
                                  <option key={l.id} value={String(l.id)}>
                                    {l.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                          <div className="space-y-2">
                            <Label htmlFor={`decision-notes-${r.id}`}>Notes</Label>
                            <Textarea
                              id={`decision-notes-${r.id}`}
                              rows={2}
                              value={decisionNotes}
                              onChange={(e) => setDecisionNotes(e.target.value)}
                              data-testid={`input-decision-notes-${r.id}`}
                            />
                          </div>
                          <p className="text-xs text-muted-foreground flex items-start gap-2">
                            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                            Recording an assessment is an observation and does not verify the claim. Verifying is the
                            organization&rsquo;s confirmation, and only a verified skill counts toward a requirement.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!decisionLevelId || assess.isPending}
                              onClick={() =>
                                assess.mutate({
                                  organizationId,
                                  recordId: r.id,
                                  data: {
                                    levelId: Number(decisionLevelId),
                                    assessedAt: todayIso(),
                                    ...(decisionNotes.trim() ? { notes: decisionNotes.trim() } : {}),
                                  },
                                })
                              }
                              data-testid={`button-assess-${r.id}`}
                            >
                              Record assessment
                            </Button>
                            <Button
                              size="sm"
                              disabled={verify.isPending || (!!decisionSkill?.proficiencyApplicable && !decisionLevelId)}
                              onClick={() =>
                                verify.mutate({
                                  organizationId,
                                  recordId: r.id,
                                  data: {
                                    assessedAt: todayIso(),
                                    ...(decisionLevelId ? { levelId: Number(decisionLevelId) } : {}),
                                    ...(decisionNotes.trim() ? { notes: decisionNotes.trim() } : {}),
                                  },
                                })
                              }
                              data-testid={`button-verify-${r.id}`}
                            >
                              <ShieldCheck className="h-4 w-4 mr-2" aria-hidden="true" />
                              Verify
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={decisionNotes.trim().length === 0 || reject.isPending}
                              onClick={() =>
                                reject.mutate({
                                  organizationId,
                                  recordId: r.id,
                                  data: { reason: decisionNotes.trim(), assessedAt: todayIso() },
                                })
                              }
                              data-testid={`button-reject-${r.id}`}
                            >
                              Reject (reason required)
                            </Button>
                            <Button size="sm" variant="ghost" onClick={clearDecision}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* --- Position requirements (row 9) --- */}
        <TabsContent value="requirements" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="h-5 w-5" aria-hidden="true" />
                What a position requires
              </CardTitle>
              <CardDescription>
                Recording a requirement makes a gap visible. It does not block an appointment, move anybody, or change
                anyone&rsquo;s employment.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 max-w-md">
                <Label htmlFor="req-position">Position</Label>
                <select
                  id="req-position"
                  className={SELECT_CLASS}
                  value={positionId}
                  onChange={(e) => setPositionId(e.target.value)}
                  data-testid="select-requirement-position"
                >
                  <option value="">Choose a position</option>
                  {(positions.data ?? []).map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>

              {positionNum > 0 && (
                <form
                  className="space-y-4 border rounded-md p-4"
                  data-testid="form-add-requirement"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!reqSkillId) return;
                    addRequirement.mutate({
                      organizationId,
                      positionId: positionNum,
                      data: {
                        skillId: Number(reqSkillId),
                        mandatory: reqMandatory,
                        ...(reqLevelId ? { minimumLevelId: Number(reqLevelId) } : {}),
                      },
                    });
                  }}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="req-skill">Skill</Label>
                      <select
                        id="req-skill"
                        className={SELECT_CLASS}
                        value={reqSkillId}
                        onChange={(e) => setReqSkillId(e.target.value)}
                        data-testid="select-requirement-skill"
                      >
                        <option value="">Choose a skill</option>
                        {(skills.data ?? []).map((s) => (
                          <option key={s.id} value={String(s.id)}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="req-level">Minimum level (optional)</Label>
                      <select
                        id="req-level"
                        className={SELECT_CLASS}
                        value={reqLevelId}
                        onChange={(e) => setReqLevelId(e.target.value)}
                        data-testid="select-requirement-level"
                      >
                        <option value="">Any level</option>
                        {levels.map((l) => (
                          <option key={l.id} value={String(l.id)}>
                            {l.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={reqMandatory}
                      onChange={(e) => setReqMandatory(e.target.checked)}
                      data-testid="checkbox-requirement-mandatory"
                    />
                    Mandatory for this role
                  </label>
                  <Button
                    type="submit"
                    disabled={!reqSkillId || addRequirement.isPending}
                    data-testid="button-submit-requirement"
                  >
                    {addRequirement.isPending ? 'Adding…' : 'Add requirement'}
                  </Button>
                </form>
              )}

              {positionNum === 0 ? null : requirements.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : requirements.error ? (
                <QueryError onRetry={() => void requirements.refetch()} />
              ) : (requirements.data ?? []).filter((r) => r.active).length === 0 ? (
                <p className="py-6 text-center text-muted-foreground" data-testid="text-no-requirements">
                  This position has no skill requirements recorded.
                </p>
              ) : (
                <div className="space-y-2" data-testid="list-requirements">
                  {(requirements.data ?? [])
                    .filter((r) => r.active)
                    .map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between gap-3 border rounded-md px-3 py-2"
                        data-testid={`row-requirement-${r.id}`}
                      >
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{skillsById.get(r.skillId)?.name ?? `Skill #${r.skillId}`}</span>
                          {r.minimumLevelId && (
                            <Badge variant="outline">Min: {levelsById.get(r.minimumLevelId)?.label ?? '—'}</Badge>
                          )}
                          <Badge variant={r.mandatory ? 'default' : 'secondary'}>
                            {r.mandatory ? 'Mandatory' : 'Desirable'}
                          </Badge>
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={removeRequirement.isPending}
                          onClick={() =>
                            setWithdrawTarget({ id: r.id, skillName: skillsById.get(r.skillId)?.name ?? `Skill #${r.skillId}` })
                          }
                          data-testid={`button-remove-requirement-${r.id}`}
                        >
                          Withdraw
                        </Button>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
          {/* Withdrawal sets the requirement inactive (never deletes it); the
              hook's own onSuccess/onError toast and refresh. */}
          <ConfirmActionDialog
            open={withdrawTarget !== null}
            onOpenChange={(o) => {
              if (!o) setWithdrawTarget(null);
            }}
            title="Withdraw requirement?"
            description={
              <p>
                {`“${withdrawTarget?.skillName}” will no longer be required for “${
                  (positions.data ?? []).find((p) => p.id === positionNum)?.title ?? 'this position'
                }” and will stop counting in gap analysis.`}{' '}
                The requirement is kept for audit history, and adding the same skill again reinstates it.
              </p>
            }
            confirmLabel="Withdraw Requirement"
            onConfirm={() =>
              withdrawTarget ? removeRequirement.mutateAsync({ organizationId, requirementId: withdrawTarget.id }) : undefined
            }
            testId="dialog-withdraw-requirement"
          />
        </TabsContent>

        {/* --- Gap analysis (row 10) --- */}
        <TabsContent value="gaps" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" aria-hidden="true" />
                Gap analysis
              </CardTitle>
              <CardDescription className="flex items-start gap-2">
                <Info className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  Only verified capability counts toward a requirement. &ldquo;No verified evidence&rdquo; means the
                  organization has not confirmed the skill — often because nobody has assessed it yet. It is not a
                  finding that the employee lacks it.
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="gap-employee">Employee</Label>
                  <select
                    id="gap-employee"
                    className={SELECT_CLASS}
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                    data-testid="select-gap-employee"
                  >
                    <option value="">Choose an employee</option>
                    {employeeOptions.map((e) => (
                      <option key={e.id} value={String(e.id)}>
                        {[e.firstName, e.lastName].filter(Boolean).join(' ') || `Employee #${e.id}`}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gap-position">Measured against</Label>
                  <select
                    id="gap-position"
                    className={SELECT_CLASS}
                    value={positionId}
                    onChange={(e) => setPositionId(e.target.value)}
                    data-testid="select-gap-position"
                  >
                    <option value="">Choose a position</option>
                    {(positions.data ?? []).map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {employeeNum === 0 || positionNum === 0 ? (
                <p className="py-6 text-center text-muted-foreground" data-testid="text-gap-prompt">
                  Choose an employee and a position to compare.
                </p>
              ) : gaps.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : gaps.error ? (
                <QueryError onRetry={() => void gaps.refetch()} />
              ) : (gaps.data?.gaps ?? []).length === 0 ? (
                <p className="py-6 text-center text-muted-foreground" data-testid="text-no-gaps">
                  That position has no skill requirements recorded.
                </p>
              ) : (
                <div className="space-y-2" data-testid="list-gaps">
                  {(gaps.data?.gaps ?? []).map((g) => {
                    const state = GAP_STATE[g.state] ?? { label: g.state, className: 'bg-muted' };
                    return (
                      <div
                        key={g.skillId}
                        className="flex items-center justify-between gap-3 border rounded-md px-3 py-2"
                        data-testid={`row-gap-${g.skillId}`}
                      >
                        <div className="min-w-0">
                          <span className="font-medium">{g.skillName}</span>
                          <p className="text-sm text-muted-foreground">
                            {g.requiredLevelLabel ? `Requires ${g.requiredLevelLabel}` : 'Required'}
                            {g.verifiedLevelLabel ? ` · Verified at ${g.verifiedLevelLabel}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                          {g.mandatory && <Badge variant="outline">Mandatory</Badge>}
                          {g.hasUnverifiedClaim && (
                            <Badge className="bg-blue-100 text-blue-900" data-testid={`badge-unverified-${g.skillId}`}>
                              Unverified claim on file
                            </Badge>
                          )}
                          {g.evidenceExpired && (
                            <Badge className="bg-amber-100 text-amber-900" data-testid={`badge-expired-${g.skillId}`}>
                              Certification expired
                            </Badge>
                          )}
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

        {/* --- Development actions (row 14) --- */}
        <TabsContent value="development" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Development actions</CardTitle>
                  <CardDescription>
                    What has been agreed. Recording an action enrols nobody on anything — Learning remains the place
                    enrolment happens.
                  </CardDescription>
                </div>
                {employeeNum > 0 && !actionOpen && (
                  <Button onClick={() => setActionOpen(true)} data-testid="button-open-action-form">
                    <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
                    Record an action
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 max-w-md">
                <Label htmlFor="dev-employee">Employee</Label>
                <select
                  id="dev-employee"
                  className={SELECT_CLASS}
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  data-testid="select-development-employee"
                >
                  <option value="">Choose an employee</option>
                  {employeeOptions.map((e) => (
                    <option key={e.id} value={String(e.id)}>
                      {[e.firstName, e.lastName].filter(Boolean).join(' ') || `Employee #${e.id}`}
                    </option>
                  ))}
                </select>
              </div>

              {employeeNum > 0 && actionOpen && (
                <form
                  className="space-y-4 border rounded-md p-4"
                  data-testid="form-add-action"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!actionText.trim()) return;
                    createAction.mutate({
                      organizationId,
                      data: {
                        employeeId: employeeNum,
                        action: actionText.trim(),
                        ...(actionSkillId ? { skillId: Number(actionSkillId) } : {}),
                        ...(actionTarget ? { targetDate: new Date(actionTarget).toISOString() } : {}),
                      },
                    });
                  }}
                >
                  <div className="space-y-2">
                    <Label htmlFor="action-text">What has been agreed?</Label>
                    <Textarea
                      id="action-text"
                      rows={2}
                      value={actionText}
                      onChange={(e) => setActionText(e.target.value)}
                      data-testid="input-action-text"
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="action-skill">Related skill (optional)</Label>
                      <select
                        id="action-skill"
                        className={SELECT_CLASS}
                        value={actionSkillId}
                        onChange={(e) => setActionSkillId(e.target.value)}
                        data-testid="select-action-skill"
                      >
                        <option value="">None</option>
                        {(skills.data ?? []).map((s) => (
                          <option key={s.id} value={String(s.id)}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="action-target">Target date (optional)</Label>
                      <Input
                        id="action-target"
                        type="date"
                        value={actionTarget}
                        onChange={(e) => setActionTarget(e.target.value)}
                        data-testid="input-action-target"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      disabled={!actionText.trim() || createAction.isPending}
                      data-testid="button-submit-action"
                    >
                      {createAction.isPending ? 'Recording…' : 'Record action'}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setActionOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              )}

              {employeeNum === 0 ? null : actions.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : actions.error ? (
                <QueryError onRetry={() => void actions.refetch()} />
              ) : (actions.data ?? []).length === 0 ? (
                <p className="py-6 text-center text-muted-foreground" data-testid="text-no-actions">
                  No development actions recorded for this employee.
                </p>
              ) : (
                <div className="space-y-2" data-testid="list-actions">
                  {(actions.data ?? []).map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between gap-3 border rounded-md px-3 py-2"
                      data-testid={`row-action-${a.id}`}
                    >
                      <div className="min-w-0">
                        <span className="font-medium">{a.action}</span>
                        <p className="text-sm text-muted-foreground">
                          {a.skillId ? `${skillsById.get(a.skillId)?.name ?? 'Skill'} · ` : ''}
                          {a.targetDate ? `Target ${new Date(a.targetDate).toLocaleDateString()}` : 'No target date'}
                        </p>
                      </div>
                      <select
                        className={`${SELECT_CLASS} max-w-[10rem]`}
                        value={a.status}
                        onChange={(e) =>
                          updateAction.mutate({
                            organizationId,
                            actionId: a.id,
                            data: { status: e.target.value as 'open' },
                          })
                        }
                        data-testid={`select-action-status-${a.id}`}
                      >
                        {ACTION_STATUS.map((s) => (
                          <option key={s} value={s}>
                            {s.replace(/_/g, ' ')}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
