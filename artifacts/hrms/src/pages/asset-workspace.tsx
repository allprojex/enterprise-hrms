import { useState } from 'react';
import { LayoutGrid, Boxes, Undo2, ShieldAlert, Archive } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { QueryError } from '@/components/query-error';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMe,
  getGetMeQueryKey,
  useListMyOrganizations,
  getListMyOrganizationsQueryKey,
  useListAssets,
  getListAssetsQueryKey,
  useListAssetIncidents,
  getListAssetIncidentsQueryKey,
  useListBranches,
  getListBranchesQueryKey,
  useListMasterDataItems,
  getListMasterDataItemsQueryKey,
  AssetStatus,
  type Asset,
} from '@workspace/api-client-react';
import {
  STATUS_LABEL,
  CONDITION_LABEL,
  RetireAssetDialog,
  MarkAssetLostDialog,
  RecoverAssetDialog,
  ReturnAssetDialog,
  IncidentRow,
} from '@/pages/assets';
import { isHrCapableRole } from '@/hooks/use-hr-capable';

const ALL = '__all__';
const PAGE_SIZE = 20;

/**
 * Internal Asset Workspace (Phase 3E, W101 — the frozen plan's own §24/§19
 * scope, filled in after W102 per an explicit numbering reconciliation
 * with the user: the frozen plan's actual W101 is this page; the earlier
 * "W101" label used for Dashboard & Reporting was corrected to W102).
 *
 * §19's own literal words: "org-wide operational surface — assignment
 * queue, outstanding returns, the open-incident queue, lost/retired
 * history — reusing every register/assignment/incident route verbatim."
 * Deliberately does NOT include maintenance or evidence areas — §19's own
 * enumeration for this specific surface names only register/assignment/
 * incident routes (unlike its own /assets description, which explicitly
 * nests maintenance/evidence into that page's own detail view) — adding
 * either here would be inventing scope the frozen plan does not name for
 * this surface. Deep per-asset management (assign new custody, maintenance,
 * evidence, full edit) remains exclusively at `/assets`, per §19's own
 * "register... with... all nested in the same detail view" wording — this
 * page links out to it rather than duplicating that detail view.
 *
 * ZERO NEW BACKEND LOGIC (§101's own explicit Definition of Done, mirroring
 * Learning's own W91 finding): every list/mutation below calls an existing
 * W96-W99 route through its existing generated hook — GET .../assets
 * (reused four ways: unfiltered register, status=assigned for the
 * assignment/outstanding-returns queue, status=lost and status=retired for
 * history) and GET .../asset-incidents, plus the existing retire/mark-lost/
 * recover/return/review/dismiss actions, whose dialogs are imported
 * directly from assets.tsx rather than reimplemented — a single source of
 * truth for both surfaces' own lifecycle rules and copy.
 *
 * AUTHORIZATION (§20's own literal "Permissions used: asset_management.
 * manage"): this entire page is management-authority-only — the identical
 * `isHrCapable` frontend gate every other org-wide HR page on this
 * platform already uses, with the backend's own `.manage`-only routes
 * remaining the real, unbypassable authorization boundary regardless of
 * nav visibility. A manager's own Team Assets visibility (current direct
 * reports, read-only, Decision 3/4) is a completely different, narrower
 * surface — reaching this page does not require and must never be granted
 * by that relationship.
 */
export default function AssetWorkspace() {
  const queryClient = useQueryClient();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const { data: myOrganizations } = useListMyOrganizations({ query: { queryKey: getListMyOrganizationsQueryKey() } });
  const currentOrg = myOrganizations?.find((m) => m.organizationId === organizationId);
  const isHrCapable = isHrCapableRole(currentOrg?.roles);

  const invalidateAssets = () => queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey(organizationId) });
  const invalidateIncidents = () => queryClient.invalidateQueries({ queryKey: getListAssetIncidentsQueryKey(organizationId) });

  const { data: branches } = useListBranches(organizationId, {
    query: { queryKey: getListBranchesQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const { data: categoryItems } = useListMasterDataItems(organizationId, 'asset_category', {
    query: { queryKey: getListMasterDataItemsQueryKey(organizationId, 'asset_category'), enabled: organizationId > 0 },
  });

  if (!isHrCapable) {
    return (
      <div className="p-6 lg:p-8">
        <QueryError title="Not authorized" message="The Asset Workspace is for HR/Asset administrators only." />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <LayoutGrid className="h-7 w-7 text-primary" aria-hidden="true" />
          Asset Workspace
        </h1>
        <p className="text-muted-foreground">
          Org-wide operational surface — register, outstanding returns, open incidents, lost/retired history. For full per-asset detail, assignment, maintenance, and evidence, use the <a href="/assets" className="underline">Asset Register</a>.
        </p>
      </div>

      <Tabs defaultValue="register">
        <TabsList>
          <TabsTrigger value="register" data-testid="tab-workspace-register">
            <Boxes className="h-4 w-4 mr-1.5" aria-hidden="true" />
            Register
          </TabsTrigger>
          <TabsTrigger value="outstanding" data-testid="tab-workspace-outstanding">
            <Undo2 className="h-4 w-4 mr-1.5" aria-hidden="true" />
            Outstanding Returns
          </TabsTrigger>
          <TabsTrigger value="incidents" data-testid="tab-workspace-incidents">
            <ShieldAlert className="h-4 w-4 mr-1.5" aria-hidden="true" />
            Open Incidents
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-workspace-history">
            <Archive className="h-4 w-4 mr-1.5" aria-hidden="true" />
            Lost / Retired
          </TabsTrigger>
        </TabsList>

        <TabsContent value="register">
          <RegisterTab organizationId={organizationId} branches={branches ?? []} categoryItems={categoryItems ?? []} onChanged={invalidateAssets} />
        </TabsContent>
        <TabsContent value="outstanding">
          <OutstandingReturnsTab organizationId={organizationId} onChanged={invalidateAssets} />
        </TabsContent>
        <TabsContent value="incidents">
          <OpenIncidentsTab organizationId={organizationId} onChanged={invalidateIncidents} />
        </TabsContent>
        <TabsContent value="history">
          <LostRetiredHistoryTab organizationId={organizationId} onChanged={invalidateAssets} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- Register (org-wide list/filter/paginate, §19/§101) ---

function RegisterTab({
  organizationId,
  branches,
  categoryItems,
  onChanged,
}: {
  organizationId: number;
  branches: { id: number; name: string }[];
  categoryItems: { id: number; code: string; label: string }[];
  onChanged: () => void;
}) {
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState(ALL);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const listParams = {
    status: statusFilter === ALL ? undefined : (statusFilter as AssetStatus),
    categoryCode: categoryFilter.trim() || undefined,
    branchId: branchFilter === ALL ? undefined : Number(branchFilter),
    search: search.trim() || undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const { data, isLoading, error, refetch } = useListAssets(organizationId, listParams, {
    query: { queryKey: getListAssetsQueryKey(organizationId, listParams), enabled: organizationId > 0 },
  });
  const assets = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4 pt-4">
      <Card>
        <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1 lg:col-span-2">
            <Label htmlFor="workspace-register-search">Search</Label>
            <Input id="workspace-register-search" placeholder="Asset tag, name, serial…" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} data-testid="input-workspace-register-search" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="workspace-register-status">Status</Label>
            <Select value={statusFilter} onValueChange={(v) => { setPage(1); setStatusFilter(v); }}>
              <SelectTrigger id="workspace-register-status" data-testid="select-workspace-register-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="workspace-register-branch">Branch</Label>
            <Select value={branchFilter} onValueChange={(v) => { setPage(1); setBranchFilter(v); }}>
              <SelectTrigger id="workspace-register-branch" data-testid="select-workspace-register-branch">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All branches</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="workspace-register-category">Category</Label>
            <Input id="workspace-register-category" value={categoryFilter} onChange={(e) => { setPage(1); setCategoryFilter(e.target.value); }} list="workspace-category-suggestions" placeholder="All categories" data-testid="input-workspace-register-category" />
            <datalist id="workspace-category-suggestions">
              {categoryItems.map((item) => (
                <option key={item.id} value={item.code}>{item.label}</option>
              ))}
            </datalist>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading assets">
          {[...Array(3)].map((_, i) => (<Skeleton key={i} className="h-14 w-full" />))}
        </div>
      ) : error ? (
        <QueryError title="Failed to load assets" message="Could not fetch the asset register." onRetry={() => refetch()} />
      ) : assets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Boxes className="h-8 w-8 text-muted-foreground mb-2" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">No assets match the current filters.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table aria-label="Asset workspace register">
            <TableHeader>
              <TableRow>
                <TableHead>Asset Tag</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead className="text-right">Quick Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.map((asset) => (
                <TableRow key={asset.id} data-testid={`row-workspace-register-${asset.id}`}>
                  <TableCell className="font-mono text-sm">{asset.assetTag}</TableCell>
                  <TableCell className="font-medium">{asset.name}</TableCell>
                  <TableCell><StatusBadge status={asset.status} /></TableCell>
                  <TableCell className="text-muted-foreground">{CONDITION_LABEL[asset.condition] ?? asset.condition}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <RetireAssetDialog organizationId={organizationId} asset={asset} onChanged={onChanged} />
                      <MarkAssetLostDialog organizationId={organizationId} asset={asset} onChanged={onChanged} />
                      <RecoverAssetDialog organizationId={organizationId} asset={asset} onChanged={onChanged} />
                      <Button size="sm" variant="ghost" asChild data-testid={`link-workspace-manage-${asset.id}`}>
                        <a href="/assets">Manage in Register</a>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Page {page} of {totalPages} ({total} asset{total === 1 ? '' : 's'})</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} data-testid="button-workspace-register-prev">Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} data-testid="button-workspace-register-next">Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Outstanding Returns / assignment queue (§19/§101) — currently-assigned assets, org-wide, actionable ---

function OutstandingReturnsTab({ organizationId, onChanged }: { organizationId: number; onChanged: () => void }) {
  const listParams = { status: 'assigned' as const, page: 1, pageSize: 100 };
  const { data, isLoading, error, refetch } = useListAssets(organizationId, listParams, {
    query: { queryKey: getListAssetsQueryKey(organizationId, listParams), enabled: organizationId > 0 },
  });
  const assets = data?.items ?? [];

  return (
    <div className="space-y-4 pt-4">
      <p className="text-sm text-muted-foreground">Every currently-assigned asset, organization-wide — the outstanding-returns queue. Close custody here, or see full custody history and current holder on the asset's own detail view in the Asset Register.</p>
      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading outstanding returns">
          {[...Array(3)].map((_, i) => (<Skeleton key={i} className="h-14 w-full" />))}
        </div>
      ) : error ? (
        <QueryError title="Failed to load outstanding returns" onRetry={() => refetch()} />
      ) : assets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Undo2 className="h-8 w-8 text-muted-foreground mb-2" aria-hidden="true" />
            <p className="text-sm text-muted-foreground" data-testid="text-workspace-no-outstanding">No assets are currently outstanding.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table aria-label="Outstanding returns">
            <TableHeader>
              <TableRow>
                <TableHead>Asset Tag</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.map((asset) => (
                <TableRow key={asset.id} data-testid={`row-workspace-outstanding-${asset.id}`}>
                  <TableCell className="font-mono text-sm">{asset.assetTag}</TableCell>
                  <TableCell className="font-medium">{asset.name}</TableCell>
                  <TableCell className="text-muted-foreground">{CONDITION_LABEL[asset.condition] ?? asset.condition}</TableCell>
                  <TableCell className="text-right">
                    <ReturnAssetDialog organizationId={organizationId} asset={asset} onChanged={onChanged} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

// --- Open Incident Queue (§19/§101) — reuses W99's own review/dismiss verbatim, never mutates the asset itself ---

function OpenIncidentsTab({ organizationId, onChanged }: { organizationId: number; onChanged: () => void }) {
  const incidentParams = { status: 'open' as const };
  const { data: incidents, isLoading, error, refetch } = useListAssetIncidents(organizationId, incidentParams, {
    query: { queryKey: getListAssetIncidentsQueryKey(organizationId, incidentParams), enabled: organizationId > 0 },
  });
  const open = incidents ?? [];

  return (
    <div className="space-y-4 pt-4">
      <p className="text-sm text-muted-foreground">Reviewing or dismissing a report never itself changes the asset's status or condition — if a resulting action (damage/loss/retirement) is warranted, apply it separately from the Asset Register.</p>
      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading open incidents">
          {[...Array(3)].map((_, i) => (<Skeleton key={i} className="h-16 w-full" />))}
        </div>
      ) : error ? (
        <QueryError title="Failed to load incidents" onRetry={() => refetch()} />
      ) : open.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <ShieldAlert className="h-8 w-8 text-muted-foreground mb-2" aria-hidden="true" />
            <p className="text-sm text-muted-foreground" data-testid="text-workspace-no-open-incidents">No open incidents.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {open.map((incident) => (
            <IncidentRow key={incident.id} organizationId={organizationId} incident={incident} onChanged={onChanged} showAsset idPrefix="workspace" />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Lost / Retired History (§19/§101) — read-only, except Recover (reused, W96) for lost assets; retired is permanently terminal ---

function LostRetiredHistoryTab({ organizationId, onChanged }: { organizationId: number; onChanged: () => void }) {
  const lostParams = { status: 'lost' as const, page: 1, pageSize: 100 };
  const retiredParams = { status: 'retired' as const, page: 1, pageSize: 100 };
  const lost = useListAssets(organizationId, lostParams, {
    query: { queryKey: getListAssetsQueryKey(organizationId, lostParams), enabled: organizationId > 0 },
  });
  const retired = useListAssets(organizationId, retiredParams, {
    query: { queryKey: getListAssetsQueryKey(organizationId, retiredParams), enabled: organizationId > 0 },
  });

  return (
    <div className="space-y-6 pt-4">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-foreground">Lost</h2>
        <AssetHistoryList query={lost} organizationId={organizationId} emptyText="No lost assets." emptyTestId="text-workspace-no-lost" renderAction={(asset) => <RecoverAssetDialog organizationId={organizationId} asset={asset} onChanged={onChanged} />} />
      </div>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-foreground">Retired</h2>
        <p className="text-xs text-muted-foreground">Retirement is permanently terminal — there is no reopen path for a retired asset.</p>
        <AssetHistoryList query={retired} organizationId={organizationId} emptyText="No retired assets." emptyTestId="text-workspace-no-retired" />
      </div>
    </div>
  );
}

function AssetHistoryList({
  query,
  emptyText,
  emptyTestId,
  renderAction,
}: {
  query: { data?: { items: Asset[] }; isLoading: boolean; error: unknown; refetch: () => void };
  organizationId: number;
  emptyText: string;
  emptyTestId: string;
  renderAction?: (asset: Asset) => React.ReactNode;
}) {
  const assets = query.data?.items ?? [];
  if (query.isLoading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label={emptyText}>
        {[...Array(2)].map((_, i) => (<Skeleton key={i} className="h-12 w-full" />))}
      </div>
    );
  }
  if (query.error) {
    return <QueryError title="Failed to load" onRetry={() => query.refetch()} />;
  }
  if (assets.length === 0) {
    return <p className="text-sm text-muted-foreground" data-testid={emptyTestId}>{emptyText}</p>;
  }
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Asset Tag</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Condition</TableHead>
            {renderAction && <TableHead className="text-right">Action</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {assets.map((asset) => (
            <TableRow key={asset.id} data-testid={`row-workspace-history-${asset.id}`}>
              <TableCell className="font-mono text-sm">{asset.assetTag}</TableCell>
              <TableCell className="font-medium">{asset.name}</TableCell>
              <TableCell className="text-muted-foreground">{CONDITION_LABEL[asset.condition] ?? asset.condition}</TableCell>
              {renderAction && <TableCell className="text-right">{renderAction(asset)}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant: 'secondary' | 'outline' | 'destructive' = status === 'lost' ? 'destructive' : status === 'available' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{STATUS_LABEL[status] ?? status}</Badge>;
}
