import { useState } from 'react';
import { Library, Download, Plus, Layers } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  useListSkills,
  getListSkillsQueryKey,
  useCreateSkill,
  useUpdateSkill,
  useImportSkillsFromMasterData,
  useGetProficiencyScale,
  getGetProficiencyScaleQueryKey,
  useCreateProficiencyScale,
  useRelabelProficiencyLevel,
} from '@workspace/api-client-react';

function errorMessage(err: unknown, fallback: string): string {
  return (
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
    (err instanceof Error ? err.message : fallback)
  );
}

const CATEGORIES = [
  { value: 'technical', label: 'Technical' },
  { value: 'behavioural', label: 'Behavioural' },
  { value: 'leadership', label: 'Leadership' },
  { value: 'functional', label: 'Functional' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'other', label: 'Other' },
];

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

/**
 * WS-14 — Skills catalogue and proficiency scale configuration (§30.26 rows 1–3).
 *
 * ONE CATALOGUE SERVES EVERY ORGANIZATION TYPE (§30.2). Nothing here is
 * business-specific, church-specific or school-specific: a skill is a named
 * capability, and what an organization calls its skills is configuration.
 *
 * TWO THINGS THIS PAGE DELIBERATELY CANNOT DO.
 *
 * It cannot delete a skill. Retiring deactivates it, because employee records
 * and position requirements already point at it and deleting would erase a
 * history somebody may need to explain later.
 *
 * It cannot reorder a proficiency level. Labels are editable; ORDER IS NOT
 * (§30.3). Every historical assessment points at a level row, so moving a level
 * up or down would silently rewrite what a past judgement meant. Publishing a
 * new scale archives the incumbent instead, and the old levels keep resolving.
 */
export default function SkillsSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const enabled = organizationId > 0;

  const [tab, setTab] = useState('catalogue');

  const [skillFormOpen, setSkillFormOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('technical');
  const [description, setDescription] = useState('');
  const [proficiencyApplicable, setProficiencyApplicable] = useState(true);
  const [certificationApplicable, setCertificationApplicable] = useState(false);

  const [scaleFormOpen, setScaleFormOpen] = useState(false);
  const [scaleName, setScaleName] = useState('');
  const [levelLabels, setLevelLabels] = useState('Awareness\nWorking\nExpert');

  const [relabelId, setRelabelId] = useState<number | null>(null);
  const [relabelValue, setRelabelValue] = useState('');

  const skills = useListSkills(organizationId, undefined, {
    query: { queryKey: getListSkillsQueryKey(organizationId), enabled },
  });
  const scale = useGetProficiencyScale(organizationId, {
    query: { queryKey: getGetProficiencyScaleQueryKey(organizationId), enabled },
  });

  const invalidate = (key: readonly unknown[]) => void queryClient.invalidateQueries({ queryKey: key });

  const createSkill = useCreateSkill({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Skill added to the catalogue' });
        setSkillFormOpen(false);
        setCode('');
        setName('');
        setDescription('');
        invalidate(getListSkillsQueryKey(organizationId));
      },
      onError: (err: unknown) =>
        toast({ title: 'Could not add', description: errorMessage(err, 'Please try again.'), variant: 'destructive' }),
    },
  });

  const updateSkill = useUpdateSkill({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Catalogue updated' });
        invalidate(getListSkillsQueryKey(organizationId));
      },
      onError: (err: unknown) =>
        toast({ title: 'Could not update', description: errorMessage(err, 'Please try again.'), variant: 'destructive' }),
    },
  });

  const importSkills = useImportSkillsFromMasterData({
    mutation: {
      onSuccess: (result: { imported?: number; skipped?: number }) => {
        toast({
          title: 'Import finished',
          description: `${result?.imported ?? 0} added, ${result?.skipped ?? 0} already present.`,
        });
        invalidate(getListSkillsQueryKey(organizationId));
      },
      onError: (err: unknown) =>
        toast({ title: 'Could not import', description: errorMessage(err, 'Please try again.'), variant: 'destructive' }),
    },
  });

  const createScale = useCreateProficiencyScale({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Scale published', description: 'The previous scale has been archived, not deleted.' });
        setScaleFormOpen(false);
        invalidate(getGetProficiencyScaleQueryKey(organizationId));
      },
      onError: (err: unknown) =>
        toast({ title: 'Could not publish', description: errorMessage(err, 'Please try again.'), variant: 'destructive' }),
    },
  });

  const relabel = useRelabelProficiencyLevel({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Level relabelled' });
        setRelabelId(null);
        setRelabelValue('');
        invalidate(getGetProficiencyScaleQueryKey(organizationId));
      },
      onError: (err: unknown) =>
        toast({ title: 'Could not relabel', description: errorMessage(err, 'Please try again.'), variant: 'destructive' }),
    },
  });

  const parsedLevels = levelLabels
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const canCreateSkill = code.trim().length > 0 && name.trim().length > 0 && !createSkill.isPending;
  const canCreateScale = scaleName.trim().length > 0 && parsedLevels.length >= 2 && !createScale.isPending;

  return (
    <div className="space-y-6" data-testid="page-skills-settings">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Library className="h-6 w-6" aria-hidden="true" />
          Skills &amp; Proficiency
        </h1>
        <p className="text-muted-foreground mt-1">
          Define the capabilities your organization recognises, and the scale it measures them on.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="catalogue">Catalogue</TabsTrigger>
          <TabsTrigger value="scale">Proficiency scale</TabsTrigger>
        </TabsList>

        <TabsContent value="catalogue" className="mt-4 space-y-4">
          <Card data-testid="card-add-skill">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Skills catalogue</CardTitle>
                  <CardDescription>
                    Codes are permanent and unique within your organization. Renaming a skill never rewrites the history
                    recorded against it.
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => importSkills.mutate({ organizationId })}
                    disabled={importSkills.isPending}
                    data-testid="button-import-master-data"
                  >
                    <Download className="h-4 w-4 mr-2" aria-hidden="true" />
                    {importSkills.isPending ? 'Importing…' : 'Import from Master Data'}
                  </Button>
                  {!skillFormOpen && (
                    <Button onClick={() => setSkillFormOpen(true)} data-testid="button-open-skill-form">
                      <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
                      Add skill
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            {skillFormOpen && (
              <CardContent>
                <form
                  className="space-y-4"
                  data-testid="form-add-skill"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!canCreateSkill) return;
                    createSkill.mutate({
                      organizationId,
                      data: {
                        code: code.trim(),
                        name: name.trim(),
                        category: category as 'technical',
                        proficiencyApplicable,
                        certificationApplicable,
                        ...(description.trim() ? { description: description.trim() } : {}),
                      },
                    });
                  }}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="skill-code">Code</Label>
                      <Input
                        id="skill-code"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        data-testid="input-skill-code"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="skill-name">Name</Label>
                      <Input
                        id="skill-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        data-testid="input-skill-name"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="skill-category">Category</Label>
                    <select
                      id="skill-category"
                      className={SELECT_CLASS}
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      data-testid="select-skill-category"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="skill-description">Description (optional)</Label>
                    <Textarea
                      id="skill-description"
                      rows={2}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      data-testid="input-skill-description"
                    />
                  </div>
                  <div className="flex flex-wrap gap-6">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={proficiencyApplicable}
                        onChange={(e) => setProficiencyApplicable(e.target.checked)}
                        data-testid="checkbox-proficiency-applicable"
                      />
                      Measured on the proficiency scale
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={certificationApplicable}
                        onChange={(e) => setCertificationApplicable(e.target.checked)}
                        data-testid="checkbox-certification-applicable"
                      />
                      Evidenced by a certification
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={!canCreateSkill} data-testid="button-submit-skill">
                      {createSkill.isPending ? 'Adding…' : 'Add to catalogue'}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setSkillFormOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            )}
          </Card>

          {skills.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : skills.error ? (
            <QueryError onRetry={() => void skills.refetch()} />
          ) : (skills.data ?? []).length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground" data-testid="text-no-skills">
                No skills yet. Add one, or import your existing Master Data skill list.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2" data-testid="list-skills">
              {(skills.data ?? []).map((s) => (
                <Card key={s.id} data-testid={`row-skill-${s.id}`}>
                  <CardContent className="py-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{s.name}</span>
                        <Badge variant="outline">{s.code}</Badge>
                        <Badge variant="secondary">{s.category}</Badge>
                        {!s.active && <Badge className="bg-muted text-muted-foreground">Retired</Badge>}
                        {s.sourceMasterDataCode && <Badge variant="outline">Imported</Badge>}
                      </div>
                      {s.description && <p className="text-sm text-muted-foreground mt-1">{s.description}</p>}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={updateSkill.isPending}
                      onClick={() =>
                        updateSkill.mutate({ organizationId, skillId: s.id, data: { active: !s.active } })
                      }
                      data-testid={`button-toggle-skill-${s.id}`}
                    >
                      {s.active ? 'Retire' : 'Reinstate'}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="scale" className="mt-4 space-y-4">
          <Card data-testid="card-proficiency-scale">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Layers className="h-5 w-5" aria-hidden="true" />
                    Proficiency scale
                  </CardTitle>
                  <CardDescription>
                    A level&rsquo;s label can be changed at any time. Its order cannot: every assessment already recorded
                    points at a level, so reordering would change what past judgements meant. Publishing a new scale
                    archives the current one instead.
                  </CardDescription>
                </div>
                {!scaleFormOpen && (
                  <Button onClick={() => setScaleFormOpen(true)} data-testid="button-open-scale-form">
                    Publish a new scale
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {scaleFormOpen && (
                <form
                  className="space-y-4 border rounded-md p-4"
                  data-testid="form-create-scale"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!canCreateScale) return;
                    createScale.mutate({
                      organizationId,
                      data: { name: scaleName.trim(), levels: parsedLevels.map((label) => ({ label })) },
                    });
                  }}
                >
                  <div className="space-y-2">
                    <Label htmlFor="scale-name">Scale name</Label>
                    <Input
                      id="scale-name"
                      value={scaleName}
                      onChange={(e) => setScaleName(e.target.value)}
                      data-testid="input-scale-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="scale-levels">Levels, lowest first — one per line</Label>
                    <Textarea
                      id="scale-levels"
                      rows={5}
                      value={levelLabels}
                      onChange={(e) => setLevelLabels(e.target.value)}
                      data-testid="input-scale-levels"
                    />
                    <p className="text-xs text-muted-foreground">
                      {parsedLevels.length} level{parsedLevels.length === 1 ? '' : 's'}. At least two are required, and
                      this order is fixed once published.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={!canCreateScale} data-testid="button-submit-scale">
                      {createScale.isPending ? 'Publishing…' : 'Publish scale'}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setScaleFormOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              )}

              {scale.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : scale.error ? (
                <QueryError onRetry={() => void scale.refetch()} />
              ) : !scale.data?.scale ? (
                <p className="text-muted-foreground py-6 text-center" data-testid="text-no-scale">
                  No proficiency scale is configured yet.
                </p>
              ) : (
                <div className="space-y-2" data-testid="list-proficiency-levels">
                  <p className="text-sm font-medium">{scale.data.scale.name}</p>
                  {(scale.data.levels ?? []).map((l) => (
                    <div
                      key={l.id}
                      className="flex items-center justify-between gap-3 border rounded-md px-3 py-2"
                      data-testid={`row-level-${l.id}`}
                    >
                      {relabelId === l.id ? (
                        <>
                          <Input
                            value={relabelValue}
                            onChange={(e) => setRelabelValue(e.target.value)}
                            className="max-w-xs"
                            data-testid={`input-relabel-${l.id}`}
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              disabled={relabelValue.trim().length === 0 || relabel.isPending}
                              onClick={() =>
                                relabel.mutate({
                                  organizationId,
                                  levelId: l.id,
                                  data: { label: relabelValue.trim() },
                                })
                              }
                              data-testid={`button-save-relabel-${l.id}`}
                            >
                              Save
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setRelabelId(null)}>
                              Cancel
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="flex items-center gap-2">
                            <Badge variant="outline">{l.ordinal}</Badge>
                            <span>{l.label}</span>
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setRelabelId(l.id);
                              setRelabelValue(l.label);
                            }}
                            data-testid={`button-relabel-${l.id}`}
                          >
                            Relabel
                          </Button>
                        </>
                      )}
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
