import { useState } from 'react';
import { Briefcase, Plus, Pencil, Star } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  useGetMe,
  getGetMeQueryKey,
  useGetRecruitmentSettings,
  getGetRecruitmentSettingsQueryKey,
  useUpdateRecruitmentSettings,
  useListRecruitmentWorkflows,
  getListRecruitmentWorkflowsQueryKey,
  useCreateRecruitmentWorkflow,
  useUpdateRecruitmentWorkflow,
  useArchiveRecruitmentWorkflow,
  useReactivateRecruitmentWorkflow,
  useSetDefaultRecruitmentWorkflow,
  useListRecruitmentStages,
  getListRecruitmentStagesQueryKey,
  useCreateRecruitmentStage,
  useUpdateRecruitmentStage,
  useArchiveRecruitmentStage,
  useReactivateRecruitmentStage,
  type RecruitmentWorkflow,
  type RecruitmentStage,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';
import { ConfirmActionDialog } from '@/components/foundation';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

const STAGE_CATEGORIES = ['applied', 'screening', 'interview', 'assessment', 'offer', 'hired', 'rejected', 'withdrawn'] as const;

function StagesPanel({ organizationId, workflowId }: { organizationId: number; workflowId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: stages, isLoading } = useListRecruitmentStages(organizationId, workflowId, {
    query: { queryKey: getListRecruitmentStagesQueryKey(organizationId, workflowId), enabled: organizationId > 0 },
  });

  const createMutation = useCreateRecruitmentStage();
  const updateMutation = useUpdateRecruitmentStage();
  const archiveMutation = useArchiveRecruitmentStage();
  const reactivateMutation = useReactivateRecruitmentStage();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RecruitmentStage | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>('applied');
  const [displayOrder, setDisplayOrder] = useState('0');
  const [isRequired, setIsRequired] = useState(false);
  const [toggleTarget, setToggleTarget] = useState<RecruitmentStage | null>(null);
  const archivingStage = toggleTarget?.isActive !== false;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListRecruitmentStagesQueryKey(organizationId, workflowId) });

  const openCreate = () => {
    setEditing(null);
    setName('');
    setCategory('applied');
    setDisplayOrder(String((stages?.length ?? 0) * 10));
    setIsRequired(false);
    setOpen(true);
  };

  const openEdit = (stage: RecruitmentStage) => {
    setEditing(stage);
    setName(stage.name);
    setCategory(stage.category);
    setDisplayOrder(String(stage.displayOrder));
    setIsRequired(stage.isRequired);
    setOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const payload = { name: name.trim(), category: category as RecruitmentStage['category'], displayOrder: Number(displayOrder), isRequired };
    const onSettled = {
      onSuccess: () => {
        invalidate();
        setOpen(false);
        toast({ title: editing ? 'Stage updated' : 'Stage created' });
      },
      onError: (err: unknown) => toast({ title: 'Could not save stage', description: errorMessage(err), variant: 'destructive' }),
    };
    if (editing) {
      updateMutation.mutate({ organizationId, workflowId, stageId: editing.id, data: payload }, onSettled);
    } else {
      createMutation.mutate({ organizationId, workflowId, data: payload }, onSettled);
    }
  };

  const handleToggle = (stage: RecruitmentStage) => {
    const mutation = stage.isActive ? archiveMutation : reactivateMutation;
    return mutation.mutateAsync(
      { organizationId, workflowId, stageId: stage.id },
      {
        onSuccess: () => { invalidate(); toast({ title: stage.isActive ? 'Stage archived' : 'Stage reactivated' }); },
        onError: (err: unknown) => toast({ title: stage.isActive ? 'Could not archive stage' : 'Could not reactivate stage', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  if (isLoading) return <Skeleton className="h-32 w-full" />;

  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Stages</h4>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" onClick={openCreate} data-testid={`button-new-stage-${workflowId}`}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              New Stage
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>{editing ? 'Edit Stage' : 'New Stage'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="stage-name">Name *</Label>
                  <Input id="stage-name" value={name} onChange={(e) => setName(e.target.value)} required data-testid="input-stage-name" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="stage-category">Category *</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger id="stage-category" data-testid="select-stage-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STAGE_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="stage-order">Display Order *</Label>
                  <Input id="stage-order" type="number" value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} required data-testid="input-stage-order" />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="stage-required" checked={isRequired} onCheckedChange={(c) => setIsRequired(c === true)} data-testid="checkbox-stage-required" />
                  <Label htmlFor="stage-required" className="font-normal">Required stage</Label>
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending || !name.trim()} data-testid="button-submit-stage">
                  {createMutation.isPending || updateMutation.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create Stage'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {!stages || stages.length === 0 ? (
        <p className="text-sm text-muted-foreground">No stages defined for this workflow yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Required</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...stages].sort((a, b) => a.displayOrder - b.displayOrder).map((stage) => (
              <TableRow key={stage.id} data-testid={`row-stage-${stage.id}`}>
                <TableCell>{stage.displayOrder}</TableCell>
                <TableCell className="font-medium">{stage.name}</TableCell>
                <TableCell className="capitalize">{stage.category}</TableCell>
                <TableCell>{stage.isRequired ? 'Yes' : 'No'}</TableCell>
                <TableCell>
                  <Badge variant={stage.isActive ? 'secondary' : 'outline'}>{stage.isActive ? 'Active' : 'Archived'}</Badge>
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="icon" variant="ghost" aria-label={`Edit ${stage.name}`} onClick={() => openEdit(stage)} data-testid={`button-edit-stage-${stage.id}`}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button size="sm" variant={stage.isActive ? 'destructive' : 'default'} onClick={() => setToggleTarget(stage)} data-testid={`button-toggle-stage-${stage.id}`}>
                    {stage.isActive ? 'Archive' : 'Reactivate'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ConfirmActionDialog
        open={toggleTarget !== null}
        onOpenChange={(o) => { if (!o) setToggleTarget(null); }}
        title={archivingStage ? 'Archive stage?' : 'Reactivate stage?'}
        description={
          archivingStage ? (
            <p>“{toggleTarget?.name}” will be archived and will no longer be offered when moving an application to a new stage. Applications already at this stage and their history are unaffected, and you can reactivate the stage later.</p>
          ) : (
            <p>“{toggleTarget?.name}” will be active again and offered when moving an application to a new stage.</p>
          )
        }
        confirmLabel={archivingStage ? 'Archive Stage' : 'Reactivate Stage'}
        tone={archivingStage ? 'destructive' : 'default'}
        onConfirm={() => (toggleTarget ? handleToggle(toggleTarget) : undefined)}
        testId={archivingStage ? 'dialog-archive-stage' : 'dialog-reactivate-stage'}
      />
    </div>
  );
}

export default function RecruitmentSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const {
    data: settings,
    isLoading: settingsLoading,
    error: settingsError,
    refetch: refetchSettings,
  } = useGetRecruitmentSettings(organizationId, {
    query: { queryKey: getGetRecruitmentSettingsQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const updateSettingsMutation = useUpdateRecruitmentSettings();

  const {
    data: workflows,
    isLoading: workflowsLoading,
    error: workflowsError,
    refetch: refetchWorkflows,
  } = useListRecruitmentWorkflows(organizationId, {
    query: { queryKey: getListRecruitmentWorkflowsQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const createWorkflowMutation = useCreateRecruitmentWorkflow();
  const updateWorkflowMutation = useUpdateRecruitmentWorkflow();
  const archiveWorkflowMutation = useArchiveRecruitmentWorkflow();
  const reactivateWorkflowMutation = useReactivateRecruitmentWorkflow();
  const setDefaultMutation = useSetDefaultRecruitmentWorkflow();

  const [settingsForm, setSettingsForm] = useState<{
    enabled: boolean;
    internalRecruitmentEnabled: boolean;
    externalRecruitmentEnabled: boolean;
    requireCandidateAccount: boolean;
    reapplicationWaitingDays: string;
    candidateDataRetentionMonths: string;
    defaultOfferExpiryDays: string;
    applicationLimitPerCandidate: string;
    duplicateCandidatePolicy: string;
    defaultWorkflowId: string;
  } | null>(null);

  if (settings && !settingsForm) {
    setSettingsForm({
      enabled: settings.enabled,
      internalRecruitmentEnabled: settings.internalRecruitmentEnabled,
      externalRecruitmentEnabled: settings.externalRecruitmentEnabled,
      requireCandidateAccount: settings.requireCandidateAccount,
      reapplicationWaitingDays: String(settings.reapplicationWaitingDays),
      candidateDataRetentionMonths: settings.candidateDataRetentionMonths != null ? String(settings.candidateDataRetentionMonths) : '',
      defaultOfferExpiryDays: settings.defaultOfferExpiryDays != null ? String(settings.defaultOfferExpiryDays) : '',
      applicationLimitPerCandidate: settings.applicationLimitPerCandidate != null ? String(settings.applicationLimitPerCandidate) : '',
      duplicateCandidatePolicy: settings.duplicateCandidatePolicy,
      defaultWorkflowId: settings.defaultWorkflowId != null ? String(settings.defaultWorkflowId) : '__none__',
    });
  }

  const [expandedWorkflowId, setExpandedWorkflowId] = useState<number | null>(null);
  const [workflowDialogOpen, setWorkflowDialogOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<RecruitmentWorkflow | null>(null);
  const [workflowName, setWorkflowName] = useState('');
  const [workflowDescription, setWorkflowDescription] = useState('');
  const [toggleWorkflowTarget, setToggleWorkflowTarget] = useState<RecruitmentWorkflow | null>(null);
  const archivingWorkflow = toggleWorkflowTarget?.isActive !== false;

  const invalidateWorkflows = () => queryClient.invalidateQueries({ queryKey: getListRecruitmentWorkflowsQueryKey(organizationId) });

  const handleSaveSettings = () => {
    if (!settingsForm) return;
    updateSettingsMutation.mutate(
      {
        organizationId,
        data: {
          enabled: settingsForm.enabled,
          internalRecruitmentEnabled: settingsForm.internalRecruitmentEnabled,
          externalRecruitmentEnabled: settingsForm.externalRecruitmentEnabled,
          requireCandidateAccount: settingsForm.requireCandidateAccount,
          reapplicationWaitingDays: Number(settingsForm.reapplicationWaitingDays),
          candidateDataRetentionMonths: settingsForm.candidateDataRetentionMonths ? Number(settingsForm.candidateDataRetentionMonths) : undefined,
          defaultOfferExpiryDays: settingsForm.defaultOfferExpiryDays ? Number(settingsForm.defaultOfferExpiryDays) : undefined,
          applicationLimitPerCandidate: settingsForm.applicationLimitPerCandidate ? Number(settingsForm.applicationLimitPerCandidate) : undefined,
          duplicateCandidatePolicy: settingsForm.duplicateCandidatePolicy as 'allow' | 'flag' | 'block',
          defaultWorkflowId: settingsForm.defaultWorkflowId === '__none__' ? null : Number(settingsForm.defaultWorkflowId),
        },
      },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetRecruitmentSettingsQueryKey(organizationId), updated);
          toast({ title: 'Recruitment settings saved' });
        },
        onError: (err) => toast({ title: 'Could not save settings', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const openCreateWorkflow = () => {
    setEditingWorkflow(null);
    setWorkflowName('');
    setWorkflowDescription('');
    setWorkflowDialogOpen(true);
  };

  const openEditWorkflow = (workflow: RecruitmentWorkflow) => {
    setEditingWorkflow(workflow);
    setWorkflowName(workflow.name);
    setWorkflowDescription(workflow.description ?? '');
    setWorkflowDialogOpen(true);
  };

  const handleSubmitWorkflow = (e: React.FormEvent) => {
    e.preventDefault();
    if (!workflowName.trim()) return;
    const payload = { name: workflowName.trim(), description: workflowDescription.trim() || undefined };
    const onSettled = {
      onSuccess: () => {
        invalidateWorkflows();
        setWorkflowDialogOpen(false);
        toast({ title: editingWorkflow ? 'Workflow updated' : 'Workflow created' });
      },
      onError: (err: unknown) => toast({ title: 'Could not save workflow', description: errorMessage(err), variant: 'destructive' }),
    };
    if (editingWorkflow) {
      updateWorkflowMutation.mutate({ organizationId, workflowId: editingWorkflow.id, data: payload }, onSettled);
    } else {
      createWorkflowMutation.mutate({ organizationId, data: payload }, onSettled);
    }
  };

  const handleToggleWorkflow = (workflow: RecruitmentWorkflow) => {
    const mutation = workflow.isActive ? archiveWorkflowMutation : reactivateWorkflowMutation;
    return mutation.mutateAsync(
      { organizationId, workflowId: workflow.id },
      {
        onSuccess: () => { invalidateWorkflows(); toast({ title: workflow.isActive ? 'Workflow archived' : 'Workflow reactivated' }); },
        onError: (err: unknown) => toast({ title: workflow.isActive ? 'Could not archive workflow' : 'Could not reactivate workflow', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleSetDefault = (workflow: RecruitmentWorkflow) => {
    setDefaultMutation.mutate(
      { organizationId, workflowId: workflow.id },
      { onSuccess: () => { invalidateWorkflows(); toast({ title: `${workflow.name} set as default workflow` }); } },
    );
  };

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <Briefcase className="h-7 w-7 text-primary" aria-hidden="true" />
          Recruitment Settings
        </h1>
        <p className="text-muted-foreground">Configure Recruitment before any requisition or vacancy exists</p>
      </div>

      {settingsError ? (
        <QueryError title="Could not load recruitment settings" onRetry={() => refetchSettings()} />
      ) : settingsLoading || !settingsForm ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">General</CardTitle>
            <CardDescription>Organization-wide Recruitment configuration</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2">
                <Checkbox id="rs-enabled" checked={settingsForm.enabled} onCheckedChange={(c) => setSettingsForm((f) => f && { ...f, enabled: c === true })} data-testid="checkbox-recruitment-enabled" />
                <Label htmlFor="rs-enabled" className="font-normal">Recruitment enabled</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="rs-internal" checked={settingsForm.internalRecruitmentEnabled} onCheckedChange={(c) => setSettingsForm((f) => f && { ...f, internalRecruitmentEnabled: c === true })} data-testid="checkbox-internal-recruitment" />
                <Label htmlFor="rs-internal" className="font-normal">Internal recruitment enabled</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="rs-external" checked={settingsForm.externalRecruitmentEnabled} onCheckedChange={(c) => setSettingsForm((f) => f && { ...f, externalRecruitmentEnabled: c === true })} data-testid="checkbox-external-recruitment" />
                <Label htmlFor="rs-external" className="font-normal">External recruitment enabled</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="rs-candidate-account" checked={settingsForm.requireCandidateAccount} onCheckedChange={(c) => setSettingsForm((f) => f && { ...f, requireCandidateAccount: c === true })} data-testid="checkbox-require-candidate-account" />
                <Label htmlFor="rs-candidate-account" className="font-normal">Require candidate account</Label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="rs-default-workflow">Default workflow</Label>
                <Select value={settingsForm.defaultWorkflowId} onValueChange={(v) => setSettingsForm((f) => f && { ...f, defaultWorkflowId: v })}>
                  <SelectTrigger id="rs-default-workflow" data-testid="select-default-workflow">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {(workflows ?? []).map((w) => (
                      <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="rs-duplicate-policy">Duplicate candidate policy</Label>
                <Select value={settingsForm.duplicateCandidatePolicy} onValueChange={(v) => setSettingsForm((f) => f && { ...f, duplicateCandidatePolicy: v })}>
                  <SelectTrigger id="rs-duplicate-policy" data-testid="select-duplicate-policy">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="allow">Allow</SelectItem>
                    <SelectItem value="flag">Flag for review</SelectItem>
                    <SelectItem value="block">Block</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="rs-reapplication">Reapplication waiting period (days)</Label>
                <Input id="rs-reapplication" type="number" min={0} value={settingsForm.reapplicationWaitingDays} onChange={(e) => setSettingsForm((f) => f && { ...f, reapplicationWaitingDays: e.target.value })} data-testid="input-reapplication-waiting-days" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rs-retention">Candidate data retention (months)</Label>
                <Input id="rs-retention" type="number" min={1} value={settingsForm.candidateDataRetentionMonths} onChange={(e) => setSettingsForm((f) => f && { ...f, candidateDataRetentionMonths: e.target.value })} data-testid="input-retention-months" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rs-offer-expiry">Default offer expiry (days)</Label>
                <Input id="rs-offer-expiry" type="number" min={1} value={settingsForm.defaultOfferExpiryDays} onChange={(e) => setSettingsForm((f) => f && { ...f, defaultOfferExpiryDays: e.target.value })} data-testid="input-offer-expiry-days" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rs-application-limit">Application limit per candidate</Label>
                <Input id="rs-application-limit" type="number" min={1} value={settingsForm.applicationLimitPerCandidate} onChange={(e) => setSettingsForm((f) => f && { ...f, applicationLimitPerCandidate: e.target.value })} data-testid="input-application-limit" />
              </div>
            </div>

            <Button onClick={handleSaveSettings} disabled={updateSettingsMutation.isPending} data-testid="button-save-recruitment-settings">
              {updateSettingsMutation.isPending ? 'Saving…' : 'Save Settings'}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Workflows</h2>
            <p className="text-muted-foreground">Named hiring pipelines — stage definitions only, no candidate movement</p>
          </div>
          <Dialog open={workflowDialogOpen} onOpenChange={setWorkflowDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreateWorkflow} data-testid="button-new-workflow">
                <Plus className="h-4 w-4" aria-hidden="true" />
                New Workflow
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleSubmitWorkflow}>
                <DialogHeader>
                  <DialogTitle>{editingWorkflow ? 'Edit Workflow' : 'New Workflow'}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="workflow-name">Name *</Label>
                    <Input id="workflow-name" value={workflowName} onChange={(e) => setWorkflowName(e.target.value)} required data-testid="input-workflow-name" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="workflow-description">Description</Label>
                    <Input id="workflow-description" value={workflowDescription} onChange={(e) => setWorkflowDescription(e.target.value)} data-testid="input-workflow-description" />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createWorkflowMutation.isPending || updateWorkflowMutation.isPending || !workflowName.trim()} data-testid="button-submit-workflow">
                    {createWorkflowMutation.isPending || updateWorkflowMutation.isPending ? 'Saving…' : editingWorkflow ? 'Save Changes' : 'Create Workflow'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {workflowsError ? (
          <QueryError title="Could not load recruitment workflows" onRetry={() => refetchWorkflows()} />
        ) : workflowsLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : !workflows || workflows.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
                <Briefcase className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">No recruitment workflows yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm">Create a workflow, then define its stages, before publishing any vacancy.</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Default</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workflows.map((workflow) => (
                    <>
                      <TableRow key={workflow.id} data-testid={`row-workflow-${workflow.id}`}>
                        <TableCell className="font-medium">{workflow.name}</TableCell>
                        <TableCell className="text-muted-foreground">{workflow.description ?? '—'}</TableCell>
                        <TableCell>
                          {workflow.isDefault ? <Badge variant="secondary"><Star className="h-3 w-3 mr-1" aria-hidden="true" />Default</Badge> : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={workflow.isActive ? 'secondary' : 'outline'}>{workflow.isActive ? 'Active' : 'Archived'}</Badge>
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setExpandedWorkflowId(expandedWorkflowId === workflow.id ? null : workflow.id)}
                            data-testid={`button-manage-stages-${workflow.id}`}
                          >
                            {expandedWorkflowId === workflow.id ? 'Hide Stages' : 'Manage Stages'}
                          </Button>
                          {!workflow.isDefault && (
                            <Button size="sm" variant="outline" onClick={() => handleSetDefault(workflow)} data-testid={`button-set-default-${workflow.id}`}>
                              Set Default
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" aria-label={`Edit ${workflow.name}`} onClick={() => openEditWorkflow(workflow)} data-testid={`button-edit-workflow-${workflow.id}`}>
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          <Button size="sm" variant={workflow.isActive ? 'destructive' : 'default'} onClick={() => setToggleWorkflowTarget(workflow)} data-testid={`button-toggle-workflow-${workflow.id}`}>
                            {workflow.isActive ? 'Archive' : 'Reactivate'}
                          </Button>
                        </TableCell>
                      </TableRow>
                      {expandedWorkflowId === workflow.id && (
                        <TableRow key={`${workflow.id}-stages`}>
                          <TableCell colSpan={5} className="bg-muted/30">
                            <StagesPanel organizationId={organizationId} workflowId={workflow.id} />
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      <ConfirmActionDialog
        open={toggleWorkflowTarget !== null}
        onOpenChange={(o) => { if (!o) setToggleWorkflowTarget(null); }}
        title={archivingWorkflow ? 'Archive workflow?' : 'Reactivate workflow?'}
        description={
          archivingWorkflow ? (
            <p>“{toggleWorkflowTarget?.name}” will be marked archived. Its stage definitions and history are preserved, and you can reactivate it later.</p>
          ) : (
            <p>“{toggleWorkflowTarget?.name}” will be marked active again, with its existing stage definitions.</p>
          )
        }
        confirmLabel={archivingWorkflow ? 'Archive Workflow' : 'Reactivate Workflow'}
        tone={archivingWorkflow ? 'destructive' : 'default'}
        onConfirm={() => (toggleWorkflowTarget ? handleToggleWorkflow(toggleWorkflowTarget) : undefined)}
        testId={archivingWorkflow ? 'dialog-archive-workflow' : 'dialog-reactivate-workflow'}
      />
    </div>
  );
}
