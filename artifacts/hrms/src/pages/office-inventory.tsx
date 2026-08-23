/**
 * Office Inventory, Workstream 1 — Foundation frontend
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §50, §P). Item catalogue,
 * stores, and module configuration only — no receiving/requests/approvals/
 * issuing/custody/returns/handovers/incidents/stocktake/ESS/reports/Assets-
 * handoff surfaces exist here, matching the frozen Workstream 1 boundary.
 * Department Head management is deliberately NOT on this page — it is a
 * general organizational-authority primitive, independent of this module,
 * and lives on the existing Departments page instead.
 */
import { useState } from 'react';
import { Boxes, Warehouse, Settings2, Plus, Pencil } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  useGetMe,
  getGetMeQueryKey,
  useListOfficeInventoryItems,
  getListOfficeInventoryItemsQueryKey,
  useCreateOfficeInventoryItem,
  useUpdateOfficeInventoryItem,
  useListOfficeInventoryStores,
  getListOfficeInventoryStoresQueryKey,
  useCreateOfficeInventoryStore,
  useUpdateOfficeInventoryStore,
  useListBranches,
  getListBranchesQueryKey,
  useListMembers,
  getListMembersQueryKey,
  useGetOrganizationConfig,
  getGetOrganizationConfigQueryKey,
  useUpdateOrganizationConfig,
  OfficeInventoryItemClassification,
  type OfficeInventoryItem,
  type OfficeInventoryStore,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';

const NONE = '__none__';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

const CLASSIFICATION_LABEL: Record<string, string> = {
  consumable: 'Consumable',
  returnable: 'Returnable',
};

// --- Items ---

function CreateItemDialog({ organizationId, onCreated }: { organizationId: number; onCreated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [categoryCode, setCategoryCode] = useState('');
  const [unitOfMeasure, setUnitOfMeasure] = useState('');
  const [classification, setClassification] = useState<string>('');
  const [reorderLevel, setReorderLevel] = useState('');
  const mutation = useCreateOfficeInventoryItem();

  const reset = () => {
    setName('');
    setCategoryCode('');
    setUnitOfMeasure('');
    setClassification('');
    setReorderLevel('');
  };

  const handle = () => {
    if (!name.trim() || !categoryCode.trim() || !unitOfMeasure.trim() || !classification) return;
    mutation.mutate(
      {
        organizationId,
        data: {
          name: name.trim(),
          categoryCode: categoryCode.trim(),
          unitOfMeasure: unitOfMeasure.trim(),
          classification: classification as OfficeInventoryItemClassification,
          reorderLevel: reorderLevel.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          setOpen(false);
          reset();
          onCreated();
          toast({ title: 'Item created' });
        },
        onError: (err) => toast({ title: 'Could not create item', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button data-testid="button-add-item">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add Item
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Item</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="item-name">Name</Label>
            <Input id="item-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-item-name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="item-category">Category Code</Label>
            <Input id="item-category" value={categoryCode} onChange={(e) => setCategoryCode(e.target.value)} data-testid="input-item-category" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="item-unit">Unit of Measure</Label>
            <Input id="item-unit" value={unitOfMeasure} onChange={(e) => setUnitOfMeasure(e.target.value)} placeholder="e.g. ream, box, unit" data-testid="input-item-unit" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="item-classification">Classification</Label>
            <Select value={classification} onValueChange={setClassification}>
              <SelectTrigger id="item-classification" data-testid="select-item-classification">
                <SelectValue placeholder="Choose a classification" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CLASSIFICATION_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="item-reorder">Reorder Level (optional)</Label>
            <Input id="item-reorder" type="number" min={0} step="0.01" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} data-testid="input-item-reorder" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handle} disabled={mutation.isPending || !name.trim() || !categoryCode.trim() || !unitOfMeasure.trim() || !classification} data-testid="button-confirm-add-item">
            {mutation.isPending ? 'Creating…' : 'Create Item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditItemDialog({ organizationId, item, onSaved }: { organizationId: number; item: OfficeInventoryItem; onSaved: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(item.name);
  const [categoryCode, setCategoryCode] = useState(item.categoryCode);
  const [unitOfMeasure, setUnitOfMeasure] = useState(item.unitOfMeasure);
  const [reorderLevel, setReorderLevel] = useState(item.reorderLevel ?? '');
  const [status, setStatus] = useState(item.status);
  const mutation = useUpdateOfficeInventoryItem();

  const handle = () => {
    mutation.mutate(
      {
        organizationId,
        id: item.id,
        data: { name: name.trim(), categoryCode: categoryCode.trim(), unitOfMeasure: unitOfMeasure.trim(), reorderLevel: reorderLevel.trim() || null, status },
      },
      {
        onSuccess: () => {
          setOpen(false);
          onSaved();
          toast({ title: 'Item updated' });
        },
        onError: (err) => toast({ title: 'Could not update item', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`button-edit-item-${item.id}`}>
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Item</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Code <span className="font-mono">{item.itemCode}</span> and classification (<span className="capitalize">{item.classification}</span>) are permanent and cannot be changed here.
          </p>
          <div className="space-y-2">
            <Label htmlFor={`edit-item-name-${item.id}`}>Name</Label>
            <Input id={`edit-item-name-${item.id}`} value={name} onChange={(e) => setName(e.target.value)} data-testid={`input-edit-item-name-${item.id}`} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`edit-item-category-${item.id}`}>Category Code</Label>
            <Input id={`edit-item-category-${item.id}`} value={categoryCode} onChange={(e) => setCategoryCode(e.target.value)} data-testid={`input-edit-item-category-${item.id}`} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`edit-item-unit-${item.id}`}>Unit of Measure</Label>
            <Input id={`edit-item-unit-${item.id}`} value={unitOfMeasure} onChange={(e) => setUnitOfMeasure(e.target.value)} data-testid={`input-edit-item-unit-${item.id}`} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`edit-item-reorder-${item.id}`}>Reorder Level</Label>
            <Input id={`edit-item-reorder-${item.id}`} type="number" min={0} step="0.01" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} data-testid={`input-edit-item-reorder-${item.id}`} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`edit-item-status-${item.id}`}>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger id={`edit-item-status-${item.id}`} data-testid={`select-edit-item-status-${item.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handle} disabled={mutation.isPending || !name.trim()} data-testid={`button-confirm-edit-item-${item.id}`}>
            {mutation.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ItemsTab({ organizationId }: { organizationId: number }) {
  const queryClient = useQueryClient();
  const { data: items, isLoading, error, refetch } = useListOfficeInventoryItems(organizationId, {
    query: { queryKey: getListOfficeInventoryItemsQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const handleChanged = () => {
    queryClient.invalidateQueries({ queryKey: getListOfficeInventoryItemsQueryKey(organizationId) });
    refetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <CreateItemDialog organizationId={organizationId} onCreated={handleChanged} />
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : error ? (
        <QueryError title="Could not load items" message={errorMessage(error) ?? 'Please try again.'} onRetry={() => refetch()} />
      ) : !items || items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Boxes className="h-8 w-8 text-muted-foreground mb-4" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No items yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Add the first catalog item to start tracking stock.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table aria-label="Office Inventory Items">
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Classification</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id} data-testid={`row-item-${item.id}`}>
                  <TableCell className="font-mono text-sm">{item.itemCode}</TableCell>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell className="text-muted-foreground">{item.categoryCode}</TableCell>
                  <TableCell className="text-muted-foreground">{item.unitOfMeasure}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{CLASSIFICATION_LABEL[item.classification] ?? item.classification}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.status === 'active' ? 'secondary' : 'outline'} className="capitalize">{item.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <EditItemDialog organizationId={organizationId} item={item} onSaved={handleChanged} />
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

// --- Stores ---

function CreateStoreDialog({ organizationId, onCreated }: { organizationId: number; onCreated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [branchId, setBranchId] = useState(NONE);
  const [responsibleMembershipId, setResponsibleMembershipId] = useState(NONE);
  const mutation = useCreateOfficeInventoryStore();

  const { data: branches } = useListBranches(organizationId, {
    query: { queryKey: getListBranchesQueryKey(organizationId), enabled: organizationId > 0 && open },
  });
  const { data: members } = useListMembers(organizationId, {
    query: { queryKey: getListMembersQueryKey(organizationId), enabled: organizationId > 0 && open },
  });

  const reset = () => {
    setName('');
    setCode('');
    setBranchId(NONE);
    setResponsibleMembershipId(NONE);
  };

  const handle = () => {
    if (!name.trim() || !code.trim()) return;
    mutation.mutate(
      {
        organizationId,
        data: {
          name: name.trim(),
          code: code.trim(),
          branchId: branchId === NONE ? undefined : Number(branchId),
          responsibleMembershipId: responsibleMembershipId === NONE ? undefined : Number(responsibleMembershipId),
        },
      },
      {
        onSuccess: () => {
          setOpen(false);
          reset();
          onCreated();
          toast({ title: 'Store created' });
        },
        onError: (err) => toast({ title: 'Could not create store', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button data-testid="button-add-store">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add Store
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Store</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="store-name">Name</Label>
            <Input id="store-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-store-name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="store-code">Code</Label>
            <Input id="store-code" value={code} onChange={(e) => setCode(e.target.value)} data-testid="input-store-code" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="store-branch">Branch (optional)</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger id="store-branch" data-testid="select-store-branch">
                <SelectValue placeholder="No branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No branch</SelectItem>
                {(branches ?? []).map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="store-responsible">Responsible Person (optional)</Label>
            <Select value={responsibleMembershipId} onValueChange={setResponsibleMembershipId}>
              <SelectTrigger id="store-responsible" data-testid="select-store-responsible">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Unassigned</SelectItem>
                {(members ?? []).filter((m) => m.status === 'active').map((m) => (
                  <SelectItem key={m.membershipId} value={String(m.membershipId)}>{m.firstName} {m.lastName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handle} disabled={mutation.isPending || !name.trim() || !code.trim()} data-testid="button-confirm-add-store">
            {mutation.isPending ? 'Creating…' : 'Create Store'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditStoreDialog({ organizationId, store, onSaved }: { organizationId: number; store: OfficeInventoryStore; onSaved: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(store.name);
  const [status, setStatus] = useState(store.status);
  const mutation = useUpdateOfficeInventoryStore();

  const handle = () => {
    mutation.mutate(
      { organizationId, id: store.id, data: { name: name.trim(), status } },
      {
        onSuccess: () => {
          setOpen(false);
          onSaved();
          toast({ title: 'Store updated' });
        },
        onError: (err) => toast({ title: 'Could not update store', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`button-edit-store-${store.id}`}>
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Store</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Code <span className="font-mono">{store.code}</span> is permanent and cannot be changed here.
          </p>
          <div className="space-y-2">
            <Label htmlFor={`edit-store-name-${store.id}`}>Name</Label>
            <Input id={`edit-store-name-${store.id}`} value={name} onChange={(e) => setName(e.target.value)} data-testid={`input-edit-store-name-${store.id}`} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`edit-store-status-${store.id}`}>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger id={`edit-store-status-${store.id}`} data-testid={`select-edit-store-status-${store.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handle} disabled={mutation.isPending || !name.trim()} data-testid={`button-confirm-edit-store-${store.id}`}>
            {mutation.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StoresTab({ organizationId }: { organizationId: number }) {
  const queryClient = useQueryClient();
  const { data: stores, isLoading, error, refetch } = useListOfficeInventoryStores(organizationId, {
    query: { queryKey: getListOfficeInventoryStoresQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const { data: branches } = useListBranches(organizationId, {
    query: { queryKey: getListBranchesQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const branchNameById = new Map((branches ?? []).map((b) => [b.id, b.name]));

  const handleChanged = () => {
    queryClient.invalidateQueries({ queryKey: getListOfficeInventoryStoresQueryKey(organizationId) });
    refetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <CreateStoreDialog organizationId={organizationId} onCreated={handleChanged} />
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : error ? (
        <QueryError title="Could not load stores" message={errorMessage(error) ?? 'Please try again.'} onRetry={() => refetch()} />
      ) : !stores || stores.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Warehouse className="h-8 w-8 text-muted-foreground mb-4" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No stores yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Add the first store to hold and issue stock from.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table aria-label="Office Inventory Stores">
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stores.map((store) => (
                <TableRow key={store.id} data-testid={`row-store-${store.id}`}>
                  <TableCell className="font-mono text-sm">{store.code}</TableCell>
                  <TableCell className="font-medium">{store.name}</TableCell>
                  <TableCell className="text-muted-foreground">{store.branchId != null ? (branchNameById.get(store.branchId) ?? '—') : 'No branch'}</TableCell>
                  <TableCell>
                    <Badge variant={store.status === 'active' ? 'secondary' : 'outline'} className="capitalize">{store.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <EditStoreDialog organizationId={organizationId} store={store} onSaved={handleChanged} />
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

// --- Configuration ---

function ConfigurationTab({ organizationId }: { organizationId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const namespace = 'office_inventory';

  const { data: config, isLoading } = useGetOrganizationConfig(organizationId, namespace, {
    query: { queryKey: getGetOrganizationConfigQueryKey(organizationId, namespace), enabled: organizationId > 0 },
  });
  const updateMutation = useUpdateOrganizationConfig();

  const [json, setJson] = useState('');
  const [touched, setTouched] = useState(false);

  if (config && !touched) {
    const formatted = JSON.stringify(config.data, null, 2);
    if (formatted !== json) setJson(formatted);
  }

  const handleSave = () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(json);
    } catch {
      toast({ title: 'Invalid JSON', description: 'Office Inventory configuration must be valid JSON.', variant: 'destructive' });
      return;
    }
    updateMutation.mutate(
      { organizationId, namespace, data: { data: parsed } },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetOrganizationConfigQueryKey(organizationId, namespace), updated);
          setTouched(false);
          toast({ title: 'Office Inventory configuration saved' });
        },
        onError: (err) => toast({ title: 'Could not save configuration', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Office Inventory Configuration</CardTitle>
        <CardDescription>
          Module-level defaults: item numbering format, repeat-request review window (days), cost tracking, direct issue, receipt confirmation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <>
            <Textarea
              value={json}
              onChange={(e) => { setJson(e.target.value); setTouched(true); }}
              rows={10}
              className="font-mono text-sm"
              data-testid="textarea-office-inventory-config"
              aria-label="Office Inventory configuration JSON"
            />
            <Button onClick={handleSave} disabled={updateMutation.isPending} data-testid="button-save-office-inventory-config">
              <Settings2 className="h-4 w-4" aria-hidden="true" />
              Save Configuration
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function OfficeInventory() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground">Office Inventory</h1>
        <p className="text-muted-foreground">Catalog items, stores, and module configuration.</p>
      </div>

      <Tabs defaultValue="items">
        <TabsList>
          <TabsTrigger value="items" data-testid="tab-items">Items</TabsTrigger>
          <TabsTrigger value="stores" data-testid="tab-stores">Stores</TabsTrigger>
          <TabsTrigger value="configuration" data-testid="tab-configuration">Configuration</TabsTrigger>
        </TabsList>
        <TabsContent value="items">
          <ItemsTab organizationId={organizationId} />
        </TabsContent>
        <TabsContent value="stores">
          <StoresTab organizationId={organizationId} />
        </TabsContent>
        <TabsContent value="configuration">
          <ConfigurationTab organizationId={organizationId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
