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
import { Boxes, Warehouse, Settings2, Plus, Pencil, Truck, Trash2, PackageSearch, ClipboardList, CheckCircle2, XCircle, UserCog, X, Ban, PackageCheck, Users, Undo2, ArrowLeftRight, AlertTriangle, ShieldAlert, Archive, SlidersHorizontal, SearchCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
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
  useListOfficeInventoryReceipts,
  getListOfficeInventoryReceiptsQueryKey,
  useCreateOfficeInventoryReceipt,
  useGetOfficeInventoryReceipt,
  getGetOfficeInventoryReceiptQueryKey,
  useGetOfficeInventoryStockBalance,
  getGetOfficeInventoryStockBalanceQueryKey,
  useListOfficeInventoryMyRequests,
  getListOfficeInventoryMyRequestsQueryKey,
  useCreateOfficeInventoryRequest,
  useGetOfficeInventoryRequest,
  getGetOfficeInventoryRequestQueryKey,
  useCancelOfficeInventoryRequest,
  useGetOfficeInventoryRequestApprovalContext,
  getGetOfficeInventoryRequestApprovalContextQueryKey,
  useListOfficeInventoryDepartmentRequests,
  getListOfficeInventoryDepartmentRequestsQueryKey,
  useApproveOfficeInventoryRequestLine,
  useRejectOfficeInventoryRequestLine,
  useListOfficeInventoryDelegations,
  getListOfficeInventoryDelegationsQueryKey,
  useCreateOfficeInventoryDelegation,
  useRevokeOfficeInventoryDelegation,
  useListDepartments,
  getListDepartmentsQueryKey,
  useListOfficeInventoryRequestsAwaitingFulfilment,
  getListOfficeInventoryRequestsAwaitingFulfilmentQueryKey,
  useIssueOfficeInventoryRequestLine,
  useCreateOfficeInventoryDirectIssue,
  useConfirmOfficeInventoryReceipt,
  useGetOfficeInventoryEmployeeCustody,
  getGetOfficeInventoryEmployeeCustodyQueryKey,
  useGetOfficeInventoryDepartmentCustody,
  getGetOfficeInventoryDepartmentCustodyQueryKey,
  useListEmployees,
  getListEmployeesQueryKey,
  useCreateOfficeInventoryReturn,
  useCreateOfficeInventoryHandover,
  useCreateOfficeInventoryTransfer,
  useReportOfficeInventoryIncident,
  useListOfficeInventoryIncidents,
  getListOfficeInventoryIncidentsQueryKey,
  useReviewOfficeInventoryIncident,
  useMarkOfficeInventoryIncidentMissing,
  useRecoverOfficeInventoryIncident,
  useWriteOffOfficeInventoryIncident,
  useCreateOfficeInventoryWriteOff,
  useCreateOfficeInventoryAdjustment,
  OfficeInventoryItemClassification,
  type OfficeInventoryItem,
  type OfficeInventoryStore,
  type ReceiveLineInput,
  type OfficeInventoryRequestLineInput,
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

// --- Receiving (Workstream 2) — receiving means stock has already entered
// organizational possession; this is NOT Procurement. No purchase
// requisition/RFQ/PO/approval workflow exists here. A multi-item submission
// commits atomically. No employee requests/approvals/issuing/returns exist
// yet — receiving is the only populated movement type in Workstream 2. ---

function ReceiveStockDialog({ organizationId, onCreated }: { organizationId: number; onCreated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [storeId, setStoreId] = useState('');
  const [lines, setLines] = useState<{ itemId: string; quantity: string; unitCost: string }[]>([{ itemId: '', quantity: '', unitCost: '' }]);
  const [source, setSource] = useState('');
  const [deliveryReference, setDeliveryReference] = useState('');
  const [notes, setNotes] = useState('');
  const mutation = useCreateOfficeInventoryReceipt();

  const { data: stores } = useListOfficeInventoryStores(organizationId, {
    query: { queryKey: getListOfficeInventoryStoresQueryKey(organizationId), enabled: organizationId > 0 && open },
  });
  const { data: items } = useListOfficeInventoryItems(organizationId, {
    query: { queryKey: getListOfficeInventoryItemsQueryKey(organizationId), enabled: organizationId > 0 && open },
  });

  const reset = () => {
    setStoreId('');
    setLines([{ itemId: '', quantity: '', unitCost: '' }]);
    setSource('');
    setDeliveryReference('');
    setNotes('');
  };

  const updateLine = (index: number, patch: Partial<{ itemId: string; quantity: string; unitCost: string }>) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };
  const addLine = () => setLines((prev) => [...prev, { itemId: '', quantity: '', unitCost: '' }]);
  const removeLine = (index: number) => setLines((prev) => prev.filter((_, i) => i !== index));

  const validLines: ReceiveLineInput[] = lines
    .filter((l) => l.itemId && l.quantity)
    .map((l) => ({ itemId: Number(l.itemId), quantity: l.quantity, unitCost: l.unitCost || undefined }));

  const handle = () => {
    if (!storeId || validLines.length === 0) return;
    mutation.mutate(
      {
        organizationId,
        data: {
          storeId: Number(storeId),
          lines: validLines,
          source: source.trim() || undefined,
          deliveryReference: deliveryReference.trim() || undefined,
          notes: notes.trim() || undefined,
          idempotencyKey: crypto.randomUUID(),
        },
      },
      {
        onSuccess: (receipt) => {
          setOpen(false);
          reset();
          onCreated();
          toast({ title: `Received ${receipt.lines.length} line(s) — ${receipt.referenceNumber}` });
        },
        onError: (err) => toast({ title: 'Could not receive stock', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button data-testid="button-receive-stock">
          <Truck className="h-4 w-4" aria-hidden="true" />
          Receive Stock
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Receive Stock</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="receive-store">Destination Store</Label>
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger id="receive-store" data-testid="select-receive-store">
                <SelectValue placeholder="Choose a store" />
              </SelectTrigger>
              <SelectContent>
                {(stores ?? []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Lines</Label>
            {lines.map((line, index) => (
              <div key={index} className="flex items-end gap-2" data-testid={`row-receive-line-${index}`}>
                <div className="flex-1 space-y-1">
                  <Select value={line.itemId} onValueChange={(v) => updateLine(index, { itemId: v })}>
                    <SelectTrigger data-testid={`select-receive-item-${index}`}>
                      <SelectValue placeholder="Item" />
                    </SelectTrigger>
                    <SelectContent>
                      {(items ?? []).map((i) => (
                        <SelectItem key={i.id} value={String(i.id)}>{i.name} ({i.itemCode})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input type="number" min={0} step="0.01" placeholder="Quantity" className="w-28" value={line.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} data-testid={`input-receive-quantity-${index}`} />
                <Input type="number" min={0} step="0.01" placeholder="Unit cost (optional)" className="w-36" value={line.unitCost} onChange={(e) => updateLine(index, { unitCost: e.target.value })} data-testid={`input-receive-cost-${index}`} />
                <Button type="button" size="icon" variant="ghost" onClick={() => removeLine(index)} disabled={lines.length === 1} aria-label="Remove line" data-testid={`button-remove-receive-line-${index}`}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={addLine} data-testid="button-add-receive-line">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add Line
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="receive-source">Source / Supplier (optional, descriptive only)</Label>
            <Input id="receive-source" value={source} onChange={(e) => setSource(e.target.value)} data-testid="input-receive-source" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="receive-delivery-ref">Delivery Note / Invoice Reference (optional, descriptive only)</Label>
            <Input id="receive-delivery-ref" value={deliveryReference} onChange={(e) => setDeliveryReference(e.target.value)} data-testid="input-receive-delivery-ref" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="receive-notes">Notes (optional)</Label>
            <Textarea id="receive-notes" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="textarea-receive-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handle} disabled={mutation.isPending || !storeId || validLines.length === 0} data-testid="button-confirm-receive">
            {mutation.isPending ? 'Receiving…' : 'Confirm Receive'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceiptDetailDialog({ organizationId, referenceNumber }: { organizationId: number; referenceNumber: string }) {
  const [open, setOpen] = useState(false);
  const { data: receipt, isLoading } = useGetOfficeInventoryReceipt(organizationId, referenceNumber, {
    query: { queryKey: getGetOfficeInventoryReceiptQueryKey(organizationId, referenceNumber), enabled: organizationId > 0 && open },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`button-view-receipt-${referenceNumber}`}>View</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Receipt {referenceNumber}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="space-y-2 py-2">
            {(receipt?.lines ?? []).map((line) => (
              <div key={line.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm" data-testid={`row-receipt-line-${line.id}`}>
                <span>Item #{line.itemId}</span>
                <span className="font-mono">{line.quantity}</span>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReceivingTab({ organizationId }: { organizationId: number }) {
  const queryClient = useQueryClient();
  const { data: receipts, isLoading, error, refetch } = useListOfficeInventoryReceipts(organizationId, {
    query: { queryKey: getListOfficeInventoryReceiptsQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const handleCreated = () => {
    queryClient.invalidateQueries({ queryKey: getListOfficeInventoryReceiptsQueryKey(organizationId) });
    refetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <ReceiveStockDialog organizationId={organizationId} onCreated={handleCreated} />
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : error ? (
        <QueryError title="Could not load receiving history" message={errorMessage(error) ?? 'Please try again.'} onRetry={() => refetch()} />
      ) : !receipts || receipts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Truck className="h-8 w-8 text-muted-foreground mb-4" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No stock received yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Receive your first delivery to start tracking stock.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table aria-label="Receiving History">
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Store</TableHead>
                <TableHead>Lines</TableHead>
                <TableHead>Received</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {receipts.map((r) => (
                <TableRow key={r.referenceNumber} data-testid={`row-receipt-${r.referenceNumber}`}>
                  <TableCell className="font-mono text-sm">{r.referenceNumber}</TableCell>
                  <TableCell>Store #{r.storeId}</TableCell>
                  <TableCell>{r.lineCount}</TableCell>
                  <TableCell className="text-muted-foreground">{new Date(r.occurredAt).toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <ReceiptDetailDialog organizationId={organizationId} referenceNumber={r.referenceNumber} />
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

// --- Stock (Workstream 2) — current balance, live-derived from the ledger.
// No employee/department custody view yet — that is a later workstream. ---

function StockTab({ organizationId }: { organizationId: number }) {
  const { data: items } = useListOfficeInventoryItems(organizationId, {
    query: { queryKey: getListOfficeInventoryItemsQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const [itemId, setItemId] = useState('');

  const { data: balance, isLoading, error, refetch } = useGetOfficeInventoryStockBalance(organizationId, { itemId: Number(itemId) }, {
    query: { queryKey: getGetOfficeInventoryStockBalanceQueryKey(organizationId, { itemId: Number(itemId) }), enabled: organizationId > 0 && !!itemId },
  });

  return (
    <div className="space-y-4">
      <div className="max-w-sm space-y-2">
        <Label htmlFor="stock-item">Item</Label>
        <Select value={itemId} onValueChange={setItemId}>
          <SelectTrigger id="stock-item" data-testid="select-stock-item">
            <SelectValue placeholder="Choose an item to view its balance" />
          </SelectTrigger>
          <SelectContent>
            {(items ?? []).map((i) => (
              <SelectItem key={i.id} value={String(i.id)}>{i.name} ({i.itemCode})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!itemId ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <PackageSearch className="h-8 w-8 text-muted-foreground mb-4" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Choose an item above to see its current stock.</p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : error ? (
        <QueryError title="Could not load balance" message={errorMessage(error) ?? 'Please try again.'} onRetry={() => refetch()} />
      ) : (
        <Card>
          <CardContent className="py-4 space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Organization-wide total</p>
              <p className="text-2xl font-bold text-foreground" data-testid="text-stock-total">{balance?.total}</p>
            </div>
            {(balance?.byStore ?? []).length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">By Store</p>
                {balance!.byStore.map((b) => (
                  <div key={b.storeId} className="flex items-center justify-between rounded-md border border-border p-2 text-sm" data-testid={`row-store-balance-${b.storeId}`}>
                    <span>Store #{b.storeId}</span>
                    <span className="font-mono">{b.balance}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// --- Requests (Workstream 3) — employee/department stock requests. Never
// itself a stock movement; approval never touches the ledger. No
// issue/fulfilment exists yet — that is Workstream 4. ---

const REQUEST_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  partially_approved: 'Partially Approved',
  approved: 'Approved',
  rejected: 'Rejected',
  fulfilled: 'Fulfilled',
  partially_fulfilled: 'Partially Fulfilled',
  cancelled: 'Cancelled',
};
const REQUEST_STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  pending: 'outline',
  partially_approved: 'secondary',
  approved: 'secondary',
  rejected: 'destructive',
  fulfilled: 'secondary',
  partially_fulfilled: 'secondary',
  cancelled: 'destructive',
};

function CreateRequestDialog({ organizationId, onCreated }: { organizationId: number; onCreated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [requestType, setRequestType] = useState<'employee' | 'department'>('employee');
  const [forDepartmentId, setForDepartmentId] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<{ itemId: string; quantityRequested: string }[]>([{ itemId: '', quantityRequested: '' }]);
  const mutation = useCreateOfficeInventoryRequest();

  const { data: items } = useListOfficeInventoryItems(organizationId, {
    query: { queryKey: getListOfficeInventoryItemsQueryKey(organizationId), enabled: organizationId > 0 && open },
  });
  const { data: departments } = useListDepartments(organizationId, {
    query: { queryKey: getListDepartmentsQueryKey(organizationId), enabled: organizationId > 0 && open && requestType === 'department' },
  });

  const reset = () => {
    setRequestType('employee');
    setForDepartmentId('');
    setReason('');
    setLines([{ itemId: '', quantityRequested: '' }]);
  };

  const updateLine = (index: number, patch: Partial<{ itemId: string; quantityRequested: string }>) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };
  const addLine = () => setLines((prev) => [...prev, { itemId: '', quantityRequested: '' }]);
  const removeLine = (index: number) => setLines((prev) => prev.filter((_, i) => i !== index));

  const validLines: OfficeInventoryRequestLineInput[] = lines
    .filter((l) => l.itemId && l.quantityRequested)
    .map((l) => ({ itemId: Number(l.itemId), quantityRequested: l.quantityRequested }));

  const handle = () => {
    if (validLines.length === 0) return;
    if (requestType === 'department' && !forDepartmentId) return;
    mutation.mutate(
      {
        organizationId,
        data: {
          requestType,
          forDepartmentId: requestType === 'department' ? Number(forDepartmentId) : undefined,
          reason: reason.trim() || undefined,
          lines: validLines,
        },
      },
      {
        onSuccess: (result) => {
          setOpen(false);
          reset();
          onCreated();
          toast({ title: `Request submitted — ${result.request.requestReference}` });
        },
        onError: (err) => toast({ title: 'Could not submit request', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button data-testid="button-create-request">
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Request
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Office Inventory Request</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="request-type">Request Type</Label>
            <Select value={requestType} onValueChange={(v) => setRequestType(v as 'employee' | 'department')}>
              <SelectTrigger id="request-type" data-testid="select-request-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="employee">For Myself</SelectItem>
                <SelectItem value="department">For My Department</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {requestType === 'department' && (
            <div className="space-y-2">
              <Label htmlFor="request-department">Department</Label>
              <Select value={forDepartmentId} onValueChange={setForDepartmentId}>
                <SelectTrigger id="request-department" data-testid="select-request-department">
                  <SelectValue placeholder="Choose your department" />
                </SelectTrigger>
                <SelectContent>
                  {(departments ?? []).map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Lines</Label>
            {lines.map((line, index) => (
              <div key={index} className="flex items-end gap-2" data-testid={`row-request-line-${index}`}>
                <div className="flex-1 space-y-1">
                  <Select value={line.itemId} onValueChange={(v) => updateLine(index, { itemId: v })}>
                    <SelectTrigger data-testid={`select-request-item-${index}`}>
                      <SelectValue placeholder="Item" />
                    </SelectTrigger>
                    <SelectContent>
                      {(items ?? []).map((i) => (
                        <SelectItem key={i.id} value={String(i.id)}>{i.name} ({i.itemCode})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input type="number" min={0} step="0.01" placeholder="Quantity" className="w-28" value={line.quantityRequested} onChange={(e) => updateLine(index, { quantityRequested: e.target.value })} data-testid={`input-request-quantity-${index}`} />
                <Button type="button" size="icon" variant="ghost" onClick={() => removeLine(index)} disabled={lines.length === 1} aria-label="Remove line" data-testid={`button-remove-request-line-${index}`}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={addLine} data-testid="button-add-request-line">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add Line
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="request-reason">Reason (optional)</Label>
            <Textarea id="request-reason" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="textarea-request-reason" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handle} disabled={mutation.isPending || validLines.length === 0 || (requestType === 'department' && !forDepartmentId)} data-testid="button-confirm-request">
            {mutation.isPending ? 'Submitting…' : 'Submit Request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequestDetailDialog({ organizationId, requestId, onChanged }: { organizationId: number; requestId: number; onChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useGetOfficeInventoryRequest(organizationId, requestId, {
    query: { queryKey: getGetOfficeInventoryRequestQueryKey(organizationId, requestId), enabled: organizationId > 0 && open },
  });
  const cancelMutation = useCancelOfficeInventoryRequest();

  const handleCancel = () => {
    cancelMutation.mutate(
      { organizationId, id: requestId },
      {
        onSuccess: () => {
          onChanged();
          toast({ title: 'Request cancelled' });
        },
        onError: (err) => toast({ title: 'Could not cancel request', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const canCancel = data?.request.status === 'pending' && (data?.lines ?? []).every((l) => l.approvalStatus === 'pending');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`button-view-request-${requestId}`}>View</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request {data?.request.requestReference}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="space-y-3 py-2">
            {(data?.lines ?? []).map((line) => (
              <div key={line.id} className="rounded-md border border-border p-2 text-sm space-y-1" data-testid={`row-request-detail-line-${line.id}`}>
                <div className="flex items-center justify-between">
                  <span>Item #{line.itemId} — requested {line.quantityRequested}</span>
                  <Badge variant={line.approvalStatus === 'approved' ? 'secondary' : line.approvalStatus === 'rejected' ? 'destructive' : 'outline'} className="capitalize">{line.approvalStatus}</Badge>
                </div>
                {line.approvedQuantity && <p className="text-muted-foreground">Approved: {line.approvedQuantity}{line.actedAsDelegate ? ' (via delegate)' : ''}</p>}
                {line.rejectionReason && <p className="text-muted-foreground">Reason: {line.rejectionReason}</p>}
              </div>
            ))}
            {canCancel && (
              <Button size="sm" variant="destructive" onClick={handleCancel} disabled={cancelMutation.isPending} data-testid={`button-cancel-request-${requestId}`}>
                <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                Cancel Request
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RequestsTab({ organizationId }: { organizationId: number }) {
  const queryClient = useQueryClient();
  const { data: requests, isLoading, error, refetch } = useListOfficeInventoryMyRequests(organizationId, {
    query: { queryKey: getListOfficeInventoryMyRequestsQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const handleChanged = () => {
    queryClient.invalidateQueries({ queryKey: getListOfficeInventoryMyRequestsQueryKey(organizationId) });
    refetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <CreateRequestDialog organizationId={organizationId} onCreated={handleChanged} />
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : error ? (
        <QueryError title="Could not load your requests" message={errorMessage(error) ?? 'Please try again.'} onRetry={() => refetch()} />
      ) : !requests || requests.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <ClipboardList className="h-8 w-8 text-muted-foreground mb-4" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No requests yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Submit a request for yourself or your department.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table aria-label="My Requests">
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id} data-testid={`row-my-request-${r.id}`}>
                  <TableCell className="font-mono text-sm">{r.requestReference}</TableCell>
                  <TableCell className="capitalize">{r.requestType}</TableCell>
                  <TableCell className="text-muted-foreground">{new Date(r.submittedAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <Badge variant={REQUEST_STATUS_VARIANT[r.status] ?? 'outline'}>{REQUEST_STATUS_LABEL[r.status] ?? r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <RequestDetailDialog organizationId={organizationId} requestId={r.id} onChanged={handleChanged} />
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

// --- Approvals (Workstream 3) — Department Head/delegate approval queue.
// Self-approval is permanently valid (§14) — no special-casing anywhere in
// this UI. Future custody context is not fabricated; only what is
// currently derivable (recent request history) is shown. ---

function ApproveLineDialog({ organizationId, lineId, quantityRequested, onDecided }: { organizationId: number; lineId: number; quantityRequested: string; onDecided: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [approvedQuantity, setApprovedQuantity] = useState(quantityRequested);
  const mutation = useApproveOfficeInventoryRequestLine();

  const handle = () => {
    mutation.mutate(
      { organizationId, lineId, data: { approvedQuantity } },
      {
        onSuccess: () => {
          setOpen(false);
          onDecided();
          toast({ title: 'Line approved' });
        },
        onError: (err) => toast({ title: 'Could not approve line', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setApprovedQuantity(quantityRequested); }}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid={`button-open-approve-${lineId}`}>
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          Approve…
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve Line</DialogTitle>
          <DialogDescription>Requested: {quantityRequested}. Approve in full or in part.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor={`approve-qty-${lineId}`}>Approved Quantity</Label>
          <Input id={`approve-qty-${lineId}`} type="number" min={0} step="0.01" value={approvedQuantity} onChange={(e) => setApprovedQuantity(e.target.value)} data-testid={`input-approve-quantity-${lineId}`} />
        </div>
        <DialogFooter>
          <Button onClick={handle} disabled={mutation.isPending || !approvedQuantity} data-testid={`button-confirm-approve-${lineId}`}>
            {mutation.isPending ? 'Approving…' : 'Confirm Approve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectLineDialog({ organizationId, lineId, onDecided }: { organizationId: number; lineId: number; onDecided: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const mutation = useRejectOfficeInventoryRequestLine();

  const handle = () => {
    if (!rejectionReason.trim()) return;
    mutation.mutate(
      { organizationId, lineId, data: { rejectionReason: rejectionReason.trim() } },
      {
        onSuccess: () => {
          setOpen(false);
          setRejectionReason('');
          onDecided();
          toast({ title: 'Line rejected' });
        },
        onError: (err) => toast({ title: 'Could not reject line', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setRejectionReason(''); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`button-open-reject-${lineId}`}>
          <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
          Reject…
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject Line</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor={`reject-reason-${lineId}`}>Reason (required)</Label>
          <Textarea id={`reject-reason-${lineId}`} value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} data-testid={`textarea-reject-reason-${lineId}`} />
        </div>
        <DialogFooter>
          <Button variant="destructive" onClick={handle} disabled={mutation.isPending || !rejectionReason.trim()} data-testid={`button-confirm-reject-${lineId}`}>
            {mutation.isPending ? 'Rejecting…' : 'Confirm Reject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApprovalContextDialog({ organizationId, requestId, onDecided }: { organizationId: number; requestId: number; onDecided: () => void }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useGetOfficeInventoryRequestApprovalContext(organizationId, requestId, {
    query: { queryKey: getGetOfficeInventoryRequestApprovalContextQueryKey(organizationId, requestId), enabled: organizationId > 0 && open },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid={`button-open-context-${requestId}`}>Review</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Request {data?.request.requestReference}</DialogTitle>
          <DialogDescription>Requested for department #{data?.request.forDepartmentId}{data?.request.forEmployeeId ? `, employee #${data.request.forEmployeeId}` : ''}. Reason: {data?.request.reason ?? '—'}</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="space-y-3 py-2">
            {(data?.lines ?? []).map((entry) => (
              <div key={entry.line.id} className="rounded-md border border-border p-3 space-y-2 text-sm" data-testid={`row-approval-line-${entry.line.id}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">Item #{entry.line.itemId} — requested {entry.line.quantityRequested}</span>
                  <Badge variant={entry.line.approvalStatus === 'approved' ? 'secondary' : entry.line.approvalStatus === 'rejected' ? 'destructive' : 'outline'} className="capitalize">{entry.line.approvalStatus}</Badge>
                </div>
                <p className="text-muted-foreground">Current stock available: {entry.storeAvailability.total}</p>
                {(entry.repeatRequestWarning.recentEmployeeRequests.length > 0 || entry.repeatRequestWarning.recentDepartmentRequests.length > 0) && (
                  <p className="text-xs text-amber-600 dark:text-amber-400" data-testid={`text-repeat-warning-${entry.line.id}`}>
                    Repeat request: {entry.repeatRequestWarning.recentEmployeeRequests.length} recent request(s) by this employee and {entry.repeatRequestWarning.recentDepartmentRequests.length} by this department for the same item within the last {entry.repeatRequestWarning.windowDays} days. You may still approve.
                  </p>
                )}
                {entry.line.approvalStatus === 'pending' && (
                  <div className="flex gap-2 pt-1">
                    <ApproveLineDialog organizationId={organizationId} lineId={entry.line.id} quantityRequested={entry.line.quantityRequested} onDecided={onDecided} />
                    <RejectLineDialog organizationId={organizationId} lineId={entry.line.id} onDecided={onDecided} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DelegationPanel({ organizationId, departmentId }: { organizationId: number; departmentId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [delegateMembershipId, setDelegateMembershipId] = useState('');

  const { data: delegations, refetch } = useListOfficeInventoryDelegations(organizationId, departmentId, {
    query: { queryKey: getListOfficeInventoryDelegationsQueryKey(organizationId, departmentId), enabled: organizationId > 0 },
  });
  const { data: members } = useListMembers(organizationId, {
    query: { queryKey: getListMembersQueryKey(organizationId), enabled: organizationId > 0 && pickerOpen },
  });
  const createMutation = useCreateOfficeInventoryDelegation();
  const revokeMutation = useRevokeOfficeInventoryDelegation();

  const current = (delegations ?? []).find((d) => d.validTo === null);
  const memberById = new Map((members ?? []).map((m) => [m.membershipId, m]));

  const handleChanged = () => {
    queryClient.invalidateQueries({ queryKey: getListOfficeInventoryDelegationsQueryKey(organizationId, departmentId) });
    refetch();
  };

  const handleCreate = () => {
    if (!delegateMembershipId) return;
    createMutation.mutate(
      { organizationId, departmentId, data: { delegateMembershipId: Number(delegateMembershipId) } },
      {
        onSuccess: () => {
          setPickerOpen(false);
          setDelegateMembershipId('');
          handleChanged();
          toast({ title: 'Delegate assigned' });
        },
        onError: (err) => toast({ title: 'Could not create delegation', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleRevoke = (id: number) => {
    revokeMutation.mutate(
      { organizationId, id },
      {
        onSuccess: () => {
          handleChanged();
          toast({ title: 'Delegation revoked' });
        },
        onError: (err) => toast({ title: 'Could not revoke delegation', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="flex items-center gap-2">
      {current ? (
        <>
          <span className="text-sm text-foreground" data-testid={`text-current-delegate-${departmentId}`}>
            Delegate: {memberById.get(current.delegateMembershipId) ? `${memberById.get(current.delegateMembershipId)!.firstName} ${memberById.get(current.delegateMembershipId)!.lastName}` : `Membership #${current.delegateMembershipId}`}
          </span>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleRevoke(current.id)} disabled={revokeMutation.isPending} aria-label="Revoke delegation" data-testid={`button-revoke-delegation-${departmentId}`}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </>
      ) : (
        <span className="text-sm text-muted-foreground">No delegate assigned</span>
      )}
      <Dialog open={pickerOpen} onOpenChange={(o) => { setPickerOpen(o); if (!o) setDelegateMembershipId(''); }}>
        <DialogTrigger asChild>
          <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Assign delegate" data-testid={`button-open-delegate-${departmentId}`}>
            <UserCog className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delegate Approval Authority</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor={`delegate-select-${departmentId}`}>Delegate</Label>
            <Select value={delegateMembershipId} onValueChange={setDelegateMembershipId}>
              <SelectTrigger id={`delegate-select-${departmentId}`} data-testid={`select-delegate-${departmentId}`}>
                <SelectValue placeholder="Choose a member" />
              </SelectTrigger>
              <SelectContent>
                {(members ?? []).filter((m) => m.status === 'active').map((m) => (
                  <SelectItem key={m.membershipId} value={String(m.membershipId)}>{m.firstName} {m.lastName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button onClick={handleCreate} disabled={!delegateMembershipId || createMutation.isPending} data-testid={`button-confirm-delegate-${departmentId}`}>
              {createMutation.isPending ? 'Saving…' : 'Assign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ApprovalsTab({ organizationId }: { organizationId: number }) {
  const queryClient = useQueryClient();
  const { data: departments } = useListDepartments(organizationId, {
    query: { queryKey: getListDepartmentsQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const [departmentId, setDepartmentId] = useState('');

  const { data: requests, isLoading, error, refetch } = useListOfficeInventoryDepartmentRequests(organizationId, Number(departmentId), {
    query: { queryKey: getListOfficeInventoryDepartmentRequestsQueryKey(organizationId, Number(departmentId)), enabled: organizationId > 0 && !!departmentId },
  });

  const handleChanged = () => {
    if (!departmentId) return;
    queryClient.invalidateQueries({ queryKey: getListOfficeInventoryDepartmentRequestsQueryKey(organizationId, Number(departmentId)) });
    refetch();
  };

  return (
    <div className="space-y-4">
      <div className="max-w-sm space-y-2">
        <Label htmlFor="approvals-department">Department</Label>
        <Select value={departmentId} onValueChange={setDepartmentId}>
          <SelectTrigger id="approvals-department" data-testid="select-approvals-department">
            <SelectValue placeholder="Choose a department you head" />
          </SelectTrigger>
          <SelectContent>
            {(departments ?? []).map((d) => (
              <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!departmentId ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <ClipboardList className="h-8 w-8 text-muted-foreground mb-4" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Choose a department above to review its request queue.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="py-4 flex items-center justify-between">
              <Label>Delegation</Label>
              <DelegationPanel organizationId={organizationId} departmentId={Number(departmentId)} />
            </CardContent>
          </Card>

          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : error ? (
            <QueryError title="Could not load requests" message={errorMessage(error) ?? 'You may not have approval authority for this department.'} onRetry={() => refetch()} />
          ) : !requests || requests.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-department-requests">No requests for this department.</p>
          ) : (
            <Card>
              <Table aria-label="Department Requests">
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((r) => (
                    <TableRow key={r.id} data-testid={`row-department-request-${r.id}`}>
                      <TableCell className="font-mono text-sm">{r.requestReference}</TableCell>
                      <TableCell className="capitalize">{r.requestType}</TableCell>
                      <TableCell className="text-muted-foreground">{new Date(r.submittedAt).toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant={REQUEST_STATUS_VARIANT[r.status] ?? 'outline'}>{REQUEST_STATUS_LABEL[r.status] ?? r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <ApprovalContextDialog organizationId={organizationId} requestId={r.id} onDecided={handleChanged} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// --- Issuing (Workstream 4) — Store Officer fulfilment + Direct Issue.
// Approval (W3) authorizes a quantity; this is what actually leaves the
// store. requested/approved/issued remain three permanently distinct
// facts, never collapsed into one. ---

function IssueLineDialog({ organizationId, lineId, itemId, remaining, onIssued }: { organizationId: number; lineId: number; itemId: number; remaining: string; onIssued: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [storeId, setStoreId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [expectedReturnDate, setExpectedReturnDate] = useState('');
  const mutation = useIssueOfficeInventoryRequestLine();

  const { data: stores } = useListOfficeInventoryStores(organizationId, {
    query: { queryKey: getListOfficeInventoryStoresQueryKey(organizationId), enabled: organizationId > 0 && open },
  });
  const { data: items } = useListOfficeInventoryItems(organizationId, {
    query: { queryKey: getListOfficeInventoryItemsQueryKey(organizationId), enabled: organizationId > 0 && open },
  });
  const item = (items ?? []).find((i) => i.id === itemId);
  const isReturnable = item?.classification === 'returnable';

  const reset = () => {
    setStoreId('');
    setQuantity('');
    setExpectedReturnDate('');
  };

  const handle = () => {
    if (!storeId || !quantity) return;
    mutation.mutate(
      { organizationId, lineId, data: { storeId: Number(storeId), quantity, expectedReturnDate: isReturnable && expectedReturnDate ? expectedReturnDate : undefined, idempotencyKey: crypto.randomUUID() } },
      {
        onSuccess: () => {
          setOpen(false);
          reset();
          onIssued();
          toast({ title: 'Stock issued' });
        },
        onError: (err) => toast({ title: 'Could not issue stock', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid={`button-open-issue-${lineId}`}>
          <PackageCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Issue…
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue Stock</DialogTitle>
          <DialogDescription>Remaining approved and unissued: {remaining}. Partial issue is allowed.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor={`issue-store-${lineId}`}>Store</Label>
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger id={`issue-store-${lineId}`} data-testid={`select-issue-store-${lineId}`}>
                <SelectValue placeholder="Choose a store" />
              </SelectTrigger>
              <SelectContent>
                {(stores ?? []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`issue-quantity-${lineId}`}>Quantity</Label>
            <Input id={`issue-quantity-${lineId}`} type="number" min={0} step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid={`input-issue-quantity-${lineId}`} />
          </div>
          {isReturnable && (
            <div className="space-y-2">
              <Label htmlFor={`issue-return-date-${lineId}`}>Expected Return Date (optional)</Label>
              <Input id={`issue-return-date-${lineId}`} type="date" value={expectedReturnDate} onChange={(e) => setExpectedReturnDate(e.target.value)} data-testid={`input-issue-return-date-${lineId}`} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={handle} disabled={mutation.isPending || !storeId || !quantity} data-testid={`button-confirm-issue-${lineId}`}>
            {mutation.isPending ? 'Issuing…' : 'Confirm Issue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DirectIssueDialog({ organizationId, onIssued }: { organizationId: number; onIssued: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [storeId, setStoreId] = useState('');
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [holderType, setHolderType] = useState<'employee' | 'department'>('employee');
  const [holderId, setHolderId] = useState('');
  const [reason, setReason] = useState('');
  const [expectedReturnDate, setExpectedReturnDate] = useState('');
  const mutation = useCreateOfficeInventoryDirectIssue();

  const { data: stores } = useListOfficeInventoryStores(organizationId, {
    query: { queryKey: getListOfficeInventoryStoresQueryKey(organizationId), enabled: organizationId > 0 && open },
  });
  const { data: items } = useListOfficeInventoryItems(organizationId, {
    query: { queryKey: getListOfficeInventoryItemsQueryKey(organizationId), enabled: organizationId > 0 && open },
  });
  const { data: employeesPage } = useListEmployees(organizationId, { pageSize: 200 }, {
    query: { queryKey: getListEmployeesQueryKey(organizationId, { pageSize: 200 }), enabled: organizationId > 0 && open && holderType === 'employee' },
  });
  const { data: departments } = useListDepartments(organizationId, {
    query: { queryKey: getListDepartmentsQueryKey(organizationId), enabled: organizationId > 0 && open && holderType === 'department' },
  });
  const item = (items ?? []).find((i) => i.id === Number(itemId));
  const isReturnable = item?.classification === 'returnable';

  const reset = () => {
    setStoreId('');
    setItemId('');
    setQuantity('');
    setHolderType('employee');
    setHolderId('');
    setReason('');
    setExpectedReturnDate('');
  };

  const handle = () => {
    if (!storeId || !itemId || !quantity || !holderId || !reason.trim()) return;
    mutation.mutate(
      {
        organizationId,
        data: {
          storeId: Number(storeId),
          itemId: Number(itemId),
          quantity,
          holderType,
          holderId: Number(holderId),
          reason: reason.trim(),
          expectedReturnDate: isReturnable && expectedReturnDate ? expectedReturnDate : undefined,
          idempotencyKey: crypto.randomUUID(),
        },
      },
      {
        onSuccess: () => {
          setOpen(false);
          reset();
          onIssued();
          toast({ title: 'Direct issue recorded' });
        },
        onError: (err) => toast({ title: 'Could not record direct issue', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-open-direct-issue">
          <PackageCheck className="h-4 w-4" aria-hidden="true" />
          Direct Issue
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Direct Issue</DialogTitle>
          <DialogDescription>Bypasses a prior request. Clearly distinguished historically — a reason is required.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="direct-store">Store</Label>
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger id="direct-store" data-testid="select-direct-store">
                <SelectValue placeholder="Choose a store" />
              </SelectTrigger>
              <SelectContent>
                {(stores ?? []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="direct-item">Item</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger id="direct-item" data-testid="select-direct-item">
                <SelectValue placeholder="Choose an item" />
              </SelectTrigger>
              <SelectContent>
                {(items ?? []).map((i) => (
                  <SelectItem key={i.id} value={String(i.id)}>{i.name} ({i.itemCode})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="direct-quantity">Quantity</Label>
            <Input id="direct-quantity" type="number" min={0} step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="input-direct-quantity" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="direct-holder-type">Target</Label>
            <Select value={holderType} onValueChange={(v) => { setHolderType(v as 'employee' | 'department'); setHolderId(''); }}>
              <SelectTrigger id="direct-holder-type" data-testid="select-direct-holder-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="employee">Employee</SelectItem>
                <SelectItem value="department">Department</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="direct-holder">{holderType === 'employee' ? 'Employee' : 'Department'}</Label>
            <Select value={holderId} onValueChange={setHolderId}>
              <SelectTrigger id="direct-holder" data-testid="select-direct-holder">
                <SelectValue placeholder={`Choose ${holderType === 'employee' ? 'an employee' : 'a department'}`} />
              </SelectTrigger>
              <SelectContent>
                {holderType === 'employee'
                  ? (employeesPage?.items ?? []).map((e) => (
                      <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>
                    ))
                  : (departments ?? []).map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                    ))}
              </SelectContent>
            </Select>
          </div>
          {isReturnable && (
            <div className="space-y-2">
              <Label htmlFor="direct-return-date">Expected Return Date (optional)</Label>
              <Input id="direct-return-date" type="date" value={expectedReturnDate} onChange={(e) => setExpectedReturnDate(e.target.value)} data-testid="input-direct-return-date" />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="direct-reason">Reason (required)</Label>
            <Textarea id="direct-reason" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="textarea-direct-reason" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handle} disabled={mutation.isPending || !storeId || !itemId || !quantity || !holderId || !reason.trim()} data-testid="button-confirm-direct-issue">
            {mutation.isPending ? 'Recording…' : 'Confirm Direct Issue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IssuingTab({ organizationId }: { organizationId: number }) {
  const queryClient = useQueryClient();
  const { data: entries, isLoading, error, refetch } = useListOfficeInventoryRequestsAwaitingFulfilment(organizationId, {
    query: { queryKey: getListOfficeInventoryRequestsAwaitingFulfilmentQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const handleChanged = () => {
    queryClient.invalidateQueries({ queryKey: getListOfficeInventoryRequestsAwaitingFulfilmentQueryKey(organizationId) });
    refetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <DirectIssueDialog organizationId={organizationId} onIssued={handleChanged} />
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : error ? (
        <QueryError title="Could not load the fulfilment queue" message={errorMessage(error) ?? 'Please try again.'} onRetry={() => refetch()} />
      ) : !entries || entries.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <PackageCheck className="h-8 w-8 text-muted-foreground mb-4" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-foreground mb-2">Nothing awaiting fulfilment</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Approved requests with stock still to issue will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <Card key={entry.request.id} data-testid={`row-fulfilment-request-${entry.request.id}`}>
              <CardContent className="py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-foreground">{entry.request.requestReference}</span>
                  <Badge variant={REQUEST_STATUS_VARIANT[entry.request.status] ?? 'outline'}>{REQUEST_STATUS_LABEL[entry.request.status] ?? entry.request.status}</Badge>
                </div>
                {entry.lines
                  .filter((l) => l.approvalStatus === 'approved')
                  .map((line) => {
                    const remaining = (parseFloat(line.approvedQuantity ?? '0') - parseFloat(line.quantityIssuedSoFar)).toFixed(2);
                    return (
                      <div key={line.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm" data-testid={`row-fulfilment-line-${line.id}`}>
                        <span>Item #{line.itemId} — requested {line.quantityRequested}, approved {line.approvedQuantity}, issued {line.quantityIssuedSoFar}, remaining {remaining}</span>
                        {parseFloat(remaining) > 0 && <IssueLineDialog organizationId={organizationId} lineId={line.id} itemId={line.itemId} remaining={remaining} onIssued={handleChanged} />}
                      </div>
                    );
                  })}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Custody (Workstream 4) — item accountability only, live-derived from
// the ledger; never salary/banking/statutory/personnel-file/performance/
// leave data. ---

function CustodyTab({ organizationId }: { organizationId: number }) {
  const { data: employeesPage } = useListEmployees(organizationId, { pageSize: 200 }, {
    query: { queryKey: getListEmployeesQueryKey(organizationId, { pageSize: 200 }), enabled: organizationId > 0 },
  });
  const { data: departments } = useListDepartments(organizationId, {
    query: { queryKey: getListDepartmentsQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const { data: items } = useListOfficeInventoryItems(organizationId, {
    query: { queryKey: getListOfficeInventoryItemsQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const itemById = new Map((items ?? []).map((i) => [i.id, i]));

  const [employeeId, setEmployeeId] = useState('');
  const [departmentId, setDepartmentId] = useState('');

  const { data: employeeCustody } = useGetOfficeInventoryEmployeeCustody(organizationId, Number(employeeId), {
    query: { queryKey: getGetOfficeInventoryEmployeeCustodyQueryKey(organizationId, Number(employeeId)), enabled: organizationId > 0 && !!employeeId },
  });
  const { data: departmentCustody } = useGetOfficeInventoryDepartmentCustody(organizationId, Number(departmentId), {
    query: { queryKey: getGetOfficeInventoryDepartmentCustodyQueryKey(organizationId, Number(departmentId)), enabled: organizationId > 0 && !!departmentId },
  });

  return (
    <div className="space-y-6">
      <div>
        <Label htmlFor="custody-employee" className="flex items-center gap-2 mb-2">
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          Employee Custody
        </Label>
        <Select value={employeeId} onValueChange={setEmployeeId}>
          <SelectTrigger id="custody-employee" className="max-w-sm" data-testid="select-custody-employee">
            <SelectValue placeholder="Choose an employee" />
          </SelectTrigger>
          <SelectContent>
            {(employeesPage?.items ?? []).map((e) => (
              <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {employeeId && (
          <div className="mt-3 space-y-2">
            {(employeeCustody ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-no-employee-custody">Holds nothing currently.</p>
            ) : (
              (employeeCustody ?? []).map((c) => (
                <div key={c.itemId} className="flex items-center justify-between rounded-md border border-border p-2 text-sm" data-testid={`row-employee-custody-${c.itemId}`}>
                  <span className="flex items-center gap-2">
                    {itemById.get(c.itemId)?.name ?? `Item #${c.itemId}`}
                    {c.overdue && (
                      <Badge variant="destructive" className="gap-1" data-testid={`badge-overdue-employee-${c.itemId}`}>
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        Overdue{c.expectedReturnDate ? ` since ${c.expectedReturnDate}` : ''}
                      </Badge>
                    )}
                  </span>
                  <span className="font-mono">{c.balance}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div>
        <Label htmlFor="custody-department" className="flex items-center gap-2 mb-2">
          <Warehouse className="h-3.5 w-3.5" aria-hidden="true" />
          Department Custody
        </Label>
        <Select value={departmentId} onValueChange={setDepartmentId}>
          <SelectTrigger id="custody-department" className="max-w-sm" data-testid="select-custody-department">
            <SelectValue placeholder="Choose a department" />
          </SelectTrigger>
          <SelectContent>
            {(departments ?? []).map((d) => (
              <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {departmentId && (
          <div className="mt-3 space-y-2">
            {(departmentCustody ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-no-department-custody">Holds nothing currently.</p>
            ) : (
              (departmentCustody ?? []).map((c) => (
                <div key={c.itemId} className="flex items-center justify-between rounded-md border border-border p-2 text-sm" data-testid={`row-department-custody-${c.itemId}`}>
                  <span className="flex items-center gap-2">
                    {itemById.get(c.itemId)?.name ?? `Item #${c.itemId}`}
                    {c.overdue && (
                      <Badge variant="destructive" className="gap-1" data-testid={`badge-overdue-department-${c.itemId}`}>
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        Overdue{c.expectedReturnDate ? ` since ${c.expectedReturnDate}` : ''}
                      </Badge>
                    )}
                  </span>
                  <span className="font-mono">{c.balance}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Movements (Workstream 5) — Return, Handover, Store Transfer. Each
// action creates new append-only ledger movement(s); the current holder or
// store balance is never overwritten directly. ---

function HolderPicker({
  organizationId,
  idPrefix,
  holderType,
  holderId,
  onHolderTypeChange,
  onHolderIdChange,
  label,
}: {
  organizationId: number;
  idPrefix: string;
  holderType: 'employee' | 'department';
  holderId: string;
  onHolderTypeChange: (t: 'employee' | 'department') => void;
  onHolderIdChange: (id: string) => void;
  label: string;
}) {
  const { data: employeesPage } = useListEmployees(organizationId, { pageSize: 200 }, {
    query: { queryKey: getListEmployeesQueryKey(organizationId, { pageSize: 200 }), enabled: organizationId > 0 },
  });
  const { data: departments } = useListDepartments(organizationId, {
    query: { queryKey: getListDepartmentsQueryKey(organizationId), enabled: organizationId > 0 },
  });

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Select value={holderType} onValueChange={(v) => { onHolderTypeChange(v as 'employee' | 'department'); onHolderIdChange(''); }}>
          <SelectTrigger className="w-40" id={`${idPrefix}-type`} data-testid={`select-${idPrefix}-type`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="employee">Employee</SelectItem>
            <SelectItem value="department">Department</SelectItem>
          </SelectContent>
        </Select>
        <Select value={holderId} onValueChange={onHolderIdChange}>
          <SelectTrigger id={`${idPrefix}-id`} data-testid={`select-${idPrefix}-id`}>
            <SelectValue placeholder={`Choose ${holderType === 'employee' ? 'an employee' : 'a department'}`} />
          </SelectTrigger>
          <SelectContent>
            {holderType === 'employee'
              ? (employeesPage?.items ?? []).map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>
                ))
              : (departments ?? []).map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function ReturnDialog({ organizationId }: { organizationId: number }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState('');
  const [holderType, setHolderType] = useState<'employee' | 'department'>('employee');
  const [holderId, setHolderId] = useState('');
  const [destinationStoreId, setDestinationStoreId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [condition, setCondition] = useState('');
  const [notes, setNotes] = useState('');
  const mutation = useCreateOfficeInventoryReturn();

  const { data: items } = useListOfficeInventoryItems(organizationId, {
    query: { queryKey: getListOfficeInventoryItemsQueryKey(organizationId), enabled: organizationId > 0 && open },
  });
  const { data: stores } = useListOfficeInventoryStores(organizationId, {
    query: { queryKey: getListOfficeInventoryStoresQueryKey(organizationId), enabled: organizationId > 0 && open },
  });
  const returnableItems = (items ?? []).filter((i) => i.classification === 'returnable');

  const reset = () => {
    setItemId('');
    setHolderType('employee');
    setHolderId('');
    setDestinationStoreId('');
    setQuantity('');
    setCondition('');
    setNotes('');
  };

  const handle = () => {
    if (!itemId || !holderId || !destinationStoreId || !quantity) return;
    mutation.mutate(
      {
        organizationId,
        data: {
          itemId: Number(itemId),
          holderType,
          holderId: Number(holderId),
          destinationStoreId: Number(destinationStoreId),
          quantity,
          condition: condition ? (condition as 'new' | 'good' | 'fair' | 'poor' | 'damaged') : undefined,
          notes: notes.trim() || undefined,
          idempotencyKey: crypto.randomUUID(),
        },
      },
      {
        onSuccess: () => {
          setOpen(false);
          reset();
          toast({ title: 'Return recorded' });
        },
        onError: (err) => toast({ title: 'Could not record return', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-open-return">
          <Undo2 className="h-4 w-4" aria-hidden="true" />
          Return
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Return to Store</DialogTitle>
          <DialogDescription>Return part or all of an employee's or department's outstanding custody. Validated against their current outstanding quantity.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="return-item">Item</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger id="return-item" data-testid="select-return-item">
                <SelectValue placeholder="Choose a returnable item" />
              </SelectTrigger>
              <SelectContent>
                {returnableItems.map((i) => (
                  <SelectItem key={i.id} value={String(i.id)}>{i.name} ({i.itemCode})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <HolderPicker organizationId={organizationId} idPrefix="return-holder" holderType={holderType} holderId={holderId} onHolderTypeChange={setHolderType} onHolderIdChange={setHolderId} label="Returning From" />
          <div className="space-y-2">
            <Label htmlFor="return-store">Destination Store</Label>
            <Select value={destinationStoreId} onValueChange={setDestinationStoreId}>
              <SelectTrigger id="return-store" data-testid="select-return-store">
                <SelectValue placeholder="Choose a store" />
              </SelectTrigger>
              <SelectContent>
                {(stores ?? []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="return-quantity">Quantity</Label>
            <Input id="return-quantity" type="number" min={0} step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="input-return-quantity" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="return-condition">Condition (optional)</Label>
            <Select value={condition} onValueChange={setCondition}>
              <SelectTrigger id="return-condition" data-testid="select-return-condition">
                <SelectValue placeholder="Not specified" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="good">Good</SelectItem>
                <SelectItem value="fair">Fair</SelectItem>
                <SelectItem value="poor">Poor</SelectItem>
                <SelectItem value="damaged">Damaged</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="return-notes">Notes (optional)</Label>
            <Textarea id="return-notes" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="textarea-return-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handle} disabled={mutation.isPending || !itemId || !holderId || !destinationStoreId || !quantity} data-testid="button-confirm-return">
            {mutation.isPending ? 'Recording…' : 'Confirm Return'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HandoverDialog({ organizationId }: { organizationId: number }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState('');
  const [fromHolderType, setFromHolderType] = useState<'employee' | 'department'>('employee');
  const [fromHolderId, setFromHolderId] = useState('');
  const [toHolderType, setToHolderType] = useState<'employee' | 'department'>('employee');
  const [toHolderId, setToHolderId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [condition, setCondition] = useState('');
  const [expectedReturnDate, setExpectedReturnDate] = useState('');
  const mutation = useCreateOfficeInventoryHandover();

  const { data: items } = useListOfficeInventoryItems(organizationId, {
    query: { queryKey: getListOfficeInventoryItemsQueryKey(organizationId), enabled: organizationId > 0 && open },
  });
  const returnableItems = (items ?? []).filter((i) => i.classification === 'returnable');
  const isDeptToDept = fromHolderType === 'department' && toHolderType === 'department';

  const reset = () => {
    setItemId('');
    setFromHolderType('employee');
    setFromHolderId('');
    setToHolderType('employee');
    setToHolderId('');
    setQuantity('');
    setReason('');
    setCondition('');
    setExpectedReturnDate('');
  };

  const handle = () => {
    if (!itemId || !fromHolderId || !toHolderId || !quantity) return;
    mutation.mutate(
      {
        organizationId,
        data: {
          itemId: Number(itemId),
          fromHolderType,
          fromHolderId: Number(fromHolderId),
          toHolderType,
          toHolderId: Number(toHolderId),
          quantity,
          reason: reason.trim() || undefined,
          condition: condition ? (condition as 'new' | 'good' | 'fair' | 'poor' | 'damaged') : undefined,
          expectedReturnDate: expectedReturnDate || undefined,
          idempotencyKey: crypto.randomUUID(),
        },
      },
      {
        onSuccess: () => {
          setOpen(false);
          reset();
          toast({ title: 'Handover recorded' });
        },
        onError: (err) => toast({ title: 'Could not record handover', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-open-handover">
          <Users className="h-4 w-4" aria-hidden="true" />
          Handover
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Handover Custody</DialogTitle>
          <DialogDescription>
            Move outstanding custody directly between two holders — no store involved.
            {isDeptToDept && ' A department-to-department handover requires the receiving department\'s current Head or a valid delegate.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="handover-item">Item</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger id="handover-item" data-testid="select-handover-item">
                <SelectValue placeholder="Choose a returnable item" />
              </SelectTrigger>
              <SelectContent>
                {returnableItems.map((i) => (
                  <SelectItem key={i.id} value={String(i.id)}>{i.name} ({i.itemCode})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <HolderPicker organizationId={organizationId} idPrefix="handover-from" holderType={fromHolderType} holderId={fromHolderId} onHolderTypeChange={setFromHolderType} onHolderIdChange={setFromHolderId} label="From" />
          <HolderPicker organizationId={organizationId} idPrefix="handover-to" holderType={toHolderType} holderId={toHolderId} onHolderTypeChange={setToHolderType} onHolderIdChange={setToHolderId} label="To" />
          <div className="space-y-2">
            <Label htmlFor="handover-quantity">Quantity</Label>
            <Input id="handover-quantity" type="number" min={0} step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="input-handover-quantity" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="handover-return-date">Expected Return Date (optional)</Label>
            <Input id="handover-return-date" type="date" value={expectedReturnDate} onChange={(e) => setExpectedReturnDate(e.target.value)} data-testid="input-handover-return-date" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="handover-reason">Reason (optional)</Label>
            <Textarea id="handover-reason" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="textarea-handover-reason" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handle} disabled={mutation.isPending || !itemId || !fromHolderId || !toHolderId || !quantity} data-testid="button-confirm-handover">
            {mutation.isPending ? 'Recording…' : 'Confirm Handover'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({ organizationId }: { organizationId: number }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState('');
  const [fromStoreId, setFromStoreId] = useState('');
  const [toStoreId, setToStoreId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const mutation = useCreateOfficeInventoryTransfer();

  const { data: items } = useListOfficeInventoryItems(organizationId, {
    query: { queryKey: getListOfficeInventoryItemsQueryKey(organizationId), enabled: organizationId > 0 && open },
  });
  const { data: stores } = useListOfficeInventoryStores(organizationId, {
    query: { queryKey: getListOfficeInventoryStoresQueryKey(organizationId), enabled: organizationId > 0 && open },
  });

  const reset = () => {
    setItemId('');
    setFromStoreId('');
    setToStoreId('');
    setQuantity('');
    setNotes('');
  };

  const handle = () => {
    if (!itemId || !fromStoreId || !toStoreId || !quantity) return;
    mutation.mutate(
      { organizationId, data: { itemId: Number(itemId), fromStoreId: Number(fromStoreId), toStoreId: Number(toStoreId), quantity, notes: notes.trim() || undefined, idempotencyKey: crypto.randomUUID() } },
      {
        onSuccess: () => {
          setOpen(false);
          reset();
          toast({ title: 'Transfer recorded' });
        },
        onError: (err) => toast({ title: 'Could not record transfer', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-open-transfer">
          <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
          Store Transfer
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Transfer Between Stores</DialogTitle>
          <DialogDescription>A single atomic movement — stock is never simultaneously available or unavailable in both stores.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="transfer-item">Item</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger id="transfer-item" data-testid="select-transfer-item">
                <SelectValue placeholder="Choose an item" />
              </SelectTrigger>
              <SelectContent>
                {(items ?? []).map((i) => (
                  <SelectItem key={i.id} value={String(i.id)}>{i.name} ({i.itemCode})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="transfer-from">From Store</Label>
            <Select value={fromStoreId} onValueChange={setFromStoreId}>
              <SelectTrigger id="transfer-from" data-testid="select-transfer-from">
                <SelectValue placeholder="Choose a store" />
              </SelectTrigger>
              <SelectContent>
                {(stores ?? []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="transfer-to">To Store</Label>
            <Select value={toStoreId} onValueChange={setToStoreId}>
              <SelectTrigger id="transfer-to" data-testid="select-transfer-to">
                <SelectValue placeholder="Choose a store" />
              </SelectTrigger>
              <SelectContent>
                {(stores ?? []).filter((s) => String(s.id) !== fromStoreId).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="transfer-quantity">Quantity</Label>
            <Input id="transfer-quantity" type="number" min={0} step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="input-transfer-quantity" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="transfer-notes">Notes (optional)</Label>
            <Textarea id="transfer-notes" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="textarea-transfer-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handle} disabled={mutation.isPending || !itemId || !fromStoreId || !toStoreId || !quantity} data-testid="button-confirm-transfer">
            {mutation.isPending ? 'Recording…' : 'Confirm Transfer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DirectWriteOffDialog({ organizationId }: { organizationId: number }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState('');
  const [sourceType, setSourceType] = useState<'store' | 'employee' | 'department'>('store');
  const [storeId, setStoreId] = useState('');
  const [holderId, setHolderId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const mutation = useCreateOfficeInventoryWriteOff();

  const { data: items } = useListOfficeInventoryItems(organizationId, {
    query: { queryKey: getListOfficeInventoryItemsQueryKey(organizationId), enabled: organizationId > 0 && open },
  });
  const { data: stores } = useListOfficeInventoryStores(organizationId, {
    query: { queryKey: getListOfficeInventoryStoresQueryKey(organizationId), enabled: organizationId > 0 && open && sourceType === 'store' },
  });
  const { data: employeesPage } = useListEmployees(organizationId, { pageSize: 200 }, {
    query: { queryKey: getListEmployeesQueryKey(organizationId, { pageSize: 200 }), enabled: organizationId > 0 && open && sourceType === 'employee' },
  });
  const { data: departments } = useListDepartments(organizationId, {
    query: { queryKey: getListDepartmentsQueryKey(organizationId), enabled: organizationId > 0 && open && sourceType === 'department' },
  });

  const reset = () => {
    setItemId('');
    setSourceType('store');
    setStoreId('');
    setHolderId('');
    setQuantity('');
    setReason('');
  };

  const handle = () => {
    if (!itemId || !quantity || !reason.trim()) return;
    if (sourceType === 'store' && !storeId) return;
    if (sourceType !== 'store' && !holderId) return;
    mutation.mutate(
      {
        organizationId,
        data: {
          itemId: Number(itemId),
          sourceType,
          storeId: sourceType === 'store' ? Number(storeId) : undefined,
          holderId: sourceType !== 'store' ? Number(holderId) : undefined,
          quantity,
          reason: reason.trim(),
          idempotencyKey: crypto.randomUUID(),
        },
      },
      {
        onSuccess: () => {
          setOpen(false);
          reset();
          toast({ title: 'Write-off recorded' });
        },
        onError: (err) => toast({ title: 'Could not record write-off', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-open-writeoff">
          <Archive className="h-4 w-4" aria-hidden="true" />
          Write Off
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Write Off Stock</DialogTitle>
          <DialogDescription>A direct, authoritative disposition — independent of any incident.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="writeoff-item">Item</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger id="writeoff-item" data-testid="select-writeoff-item">
                <SelectValue placeholder="Choose an item" />
              </SelectTrigger>
              <SelectContent>
                {(items ?? []).map((i) => (
                  <SelectItem key={i.id} value={String(i.id)}>{i.name} ({i.itemCode})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="writeoff-source-type">Source</Label>
            <Select value={sourceType} onValueChange={(v) => { setSourceType(v as typeof sourceType); setStoreId(''); setHolderId(''); }}>
              <SelectTrigger id="writeoff-source-type" data-testid="select-writeoff-source-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="store">Store</SelectItem>
                <SelectItem value="employee">Employee</SelectItem>
                <SelectItem value="department">Department</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {sourceType === 'store' ? (
            <div className="space-y-2">
              <Label htmlFor="writeoff-store">Store</Label>
              <Select value={storeId} onValueChange={setStoreId}>
                <SelectTrigger id="writeoff-store" data-testid="select-writeoff-store">
                  <SelectValue placeholder="Choose a store" />
                </SelectTrigger>
                <SelectContent>
                  {(stores ?? []).map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="writeoff-holder">{sourceType === 'employee' ? 'Employee' : 'Department'}</Label>
              <Select value={holderId} onValueChange={setHolderId}>
                <SelectTrigger id="writeoff-holder" data-testid="select-writeoff-holder">
                  <SelectValue placeholder={`Choose ${sourceType === 'employee' ? 'an employee' : 'a department'}`} />
                </SelectTrigger>
                <SelectContent>
                  {sourceType === 'employee'
                    ? (employeesPage?.items ?? []).map((e) => (
                        <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>
                      ))
                    : (departments ?? []).map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                      ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="writeoff-quantity">Quantity</Label>
            <Input id="writeoff-quantity" type="number" min={0} step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="input-writeoff-quantity" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="writeoff-reason">Reason (required)</Label>
            <Textarea id="writeoff-reason" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="textarea-writeoff-reason" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handle} disabled={mutation.isPending || !itemId || !quantity || !reason.trim()} data-testid="button-confirm-writeoff">
            {mutation.isPending ? 'Recording…' : 'Confirm Write-Off'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustmentDialog({ organizationId }: { organizationId: number }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [storeId, setStoreId] = useState('');
  const [itemId, setItemId] = useState('');
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const mutation = useCreateOfficeInventoryAdjustment();

  const { data: items } = useListOfficeInventoryItems(organizationId, {
    query: { queryKey: getListOfficeInventoryItemsQueryKey(organizationId), enabled: organizationId > 0 && open },
  });
  const { data: stores } = useListOfficeInventoryStores(organizationId, {
    query: { queryKey: getListOfficeInventoryStoresQueryKey(organizationId), enabled: organizationId > 0 && open },
  });

  const reset = () => {
    setStoreId('');
    setItemId('');
    setDirection('in');
    setQuantity('');
    setReason('');
  };

  const handle = () => {
    if (!storeId || !itemId || !quantity || !reason.trim()) return;
    mutation.mutate(
      { organizationId, data: { storeId: Number(storeId), itemId: Number(itemId), direction, quantity, reason: reason.trim(), idempotencyKey: crypto.randomUUID() } },
      {
        onSuccess: () => {
          setOpen(false);
          reset();
          toast({ title: 'Adjustment recorded' });
        },
        onError: (err) => toast({ title: 'Could not record adjustment', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-open-adjustment">
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          Adjust Stock
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Adjust Store Stock</DialogTitle>
          <DialogDescription>Store-only correction with an explicit reason — never a way to fix employee/department custody.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="adjustment-store">Store</Label>
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger id="adjustment-store" data-testid="select-adjustment-store">
                <SelectValue placeholder="Choose a store" />
              </SelectTrigger>
              <SelectContent>
                {(stores ?? []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="adjustment-item">Item</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger id="adjustment-item" data-testid="select-adjustment-item">
                <SelectValue placeholder="Choose an item" />
              </SelectTrigger>
              <SelectContent>
                {(items ?? []).map((i) => (
                  <SelectItem key={i.id} value={String(i.id)}>{i.name} ({i.itemCode})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="adjustment-direction">Direction</Label>
            <Select value={direction} onValueChange={(v) => setDirection(v as 'in' | 'out')}>
              <SelectTrigger id="adjustment-direction" data-testid="select-adjustment-direction">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in">Increase (found extra stock)</SelectItem>
                <SelectItem value="out">Decrease (confirmed shortfall)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="adjustment-quantity">Quantity</Label>
            <Input id="adjustment-quantity" type="number" min={0} step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="input-adjustment-quantity" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="adjustment-reason">Reason (required)</Label>
            <Textarea id="adjustment-reason" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="textarea-adjustment-reason" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handle} disabled={mutation.isPending || !storeId || !itemId || !quantity || !reason.trim()} data-testid="button-confirm-adjustment">
            {mutation.isPending ? 'Recording…' : 'Confirm Adjustment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MovementsTab({ organizationId }: { organizationId: number }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Post-issue custody events — each creates a new, permanent movement record. Nothing here edits or removes a prior issue, return, or transfer.</p>
      <div className="flex flex-wrap gap-3">
        <ReturnDialog organizationId={organizationId} />
        <HandoverDialog organizationId={organizationId} />
        <TransferDialog organizationId={organizationId} />
        <DirectWriteOffDialog organizationId={organizationId} />
        <AdjustmentDialog organizationId={organizationId} />
      </div>
    </div>
  );
}

// --- Incidents (Workstream 6) — damage/missing reporting, review,
// mark-missing, recovery, and incident-linked write-off. Reporting and
// reviewing never touch the stock ledger; mark-missing/recover/write-off
// each append their own new, explicit ledger movement. ---

function ReportIncidentDialog({ organizationId, onReported }: { organizationId: number; onReported: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState('');
  const [holderType, setHolderType] = useState<'employee' | 'department'>('employee');
  const [holderId, setHolderId] = useState('');
  const [incidentType, setIncidentType] = useState<'damage' | 'missing'>('damage');
  const [description, setDescription] = useState('');
  const mutation = useReportOfficeInventoryIncident();

  const { data: items } = useListOfficeInventoryItems(organizationId, {
    query: { queryKey: getListOfficeInventoryItemsQueryKey(organizationId), enabled: organizationId > 0 && open },
  });

  const reset = () => {
    setItemId('');
    setHolderType('employee');
    setHolderId('');
    setIncidentType('damage');
    setDescription('');
  };

  const handle = () => {
    if (!itemId || !holderId || !description.trim()) return;
    mutation.mutate(
      { organizationId, data: { itemId: Number(itemId), holderType, holderId: Number(holderId), incidentType, description: description.trim() } },
      {
        onSuccess: () => {
          setOpen(false);
          reset();
          onReported();
          toast({ title: 'Incident reported' });
        },
        onError: (err) => toast({ title: 'Could not report incident', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-open-report-incident">
          <ShieldAlert className="h-4 w-4" aria-hidden="true" />
          Report Incident
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Report Damage or Missing Item</DialogTitle>
          <DialogDescription>Only for your own current custody or your own current department's custody. This does not itself change any stock or custody quantity.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="incident-item">Item</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger id="incident-item" data-testid="select-incident-item">
                <SelectValue placeholder="Choose an item" />
              </SelectTrigger>
              <SelectContent>
                {(items ?? []).map((i) => (
                  <SelectItem key={i.id} value={String(i.id)}>{i.name} ({i.itemCode})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <HolderPicker organizationId={organizationId} idPrefix="incident-holder" holderType={holderType} holderId={holderId} onHolderTypeChange={setHolderType} onHolderIdChange={setHolderId} label="Custody" />
          <div className="space-y-2">
            <Label htmlFor="incident-type">Incident Type</Label>
            <Select value={incidentType} onValueChange={(v) => setIncidentType(v as 'damage' | 'missing')}>
              <SelectTrigger id="incident-type" data-testid="select-incident-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="damage">Damage</SelectItem>
                <SelectItem value="missing">Missing</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="incident-description">Description</Label>
            <Textarea id="incident-description" value={description} onChange={(e) => setDescription(e.target.value)} data-testid="textarea-incident-description" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handle} disabled={mutation.isPending || !itemId || !holderId || !description.trim()} data-testid="button-confirm-report-incident">
            {mutation.isPending ? 'Reporting…' : 'Submit Report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const INCIDENT_STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  open: 'destructive',
  reviewed: 'secondary',
  dismissed: 'outline',
};

function IncidentDetailPanel({ organizationId, incident, onChanged }: { organizationId: number; incident: { id: number; itemId: number; holderType: 'employee' | 'department' | null; holderId: number | null; incidentType: 'damage' | 'missing'; status: 'open' | 'reviewed' | 'dismissed' }; onChanged: () => void }) {
  const { toast } = useToast();
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [missingQuantity, setMissingQuantity] = useState('');
  const [recoverQuantity, setRecoverQuantity] = useState('');
  const [recoverStoreId, setRecoverStoreId] = useState('');
  const [writeOffQuantity, setWriteOffQuantity] = useState('');
  const [writeOffReason, setWriteOffReason] = useState('');

  const reviewMutation = useReviewOfficeInventoryIncident();
  const markMissingMutation = useMarkOfficeInventoryIncidentMissing();
  const recoverMutation = useRecoverOfficeInventoryIncident();
  const writeOffMutation = useWriteOffOfficeInventoryIncident();

  const { data: stores } = useListOfficeInventoryStores(organizationId, {
    query: { queryKey: getListOfficeInventoryStoresQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const review = (outcome: 'reviewed' | 'dismissed') => {
    reviewMutation.mutate(
      { organizationId, id: incident.id, data: { outcome, resolutionNotes: resolutionNotes.trim() || undefined } },
      {
        onSuccess: () => { onChanged(); toast({ title: `Incident ${outcome}` }); },
        onError: (err) => toast({ title: 'Could not update incident', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const markMissing = () => {
    if (!missingQuantity) return;
    markMissingMutation.mutate(
      { organizationId, id: incident.id, data: { quantity: missingQuantity, idempotencyKey: crypto.randomUUID() } },
      {
        onSuccess: () => { setMissingQuantity(''); onChanged(); toast({ title: 'Marked missing' }); },
        onError: (err) => toast({ title: 'Could not mark missing', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const recover = () => {
    if (!recoverQuantity || !recoverStoreId) return;
    recoverMutation.mutate(
      { organizationId, id: incident.id, data: { quantity: recoverQuantity, destinationStoreId: Number(recoverStoreId), idempotencyKey: crypto.randomUUID() } },
      {
        onSuccess: () => { setRecoverQuantity(''); setRecoverStoreId(''); onChanged(); toast({ title: 'Recovery recorded' }); },
        onError: (err) => toast({ title: 'Could not record recovery', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const writeOffIncident = () => {
    if (!writeOffQuantity || !writeOffReason.trim()) return;
    writeOffMutation.mutate(
      { organizationId, id: incident.id, data: { quantity: writeOffQuantity, reason: writeOffReason.trim(), idempotencyKey: crypto.randomUUID() } },
      {
        onSuccess: () => { setWriteOffQuantity(''); setWriteOffReason(''); onChanged(); toast({ title: 'Write-off recorded' }); },
        onError: (err) => toast({ title: 'Could not record write-off', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="space-y-4 rounded-md border border-border p-4" data-testid={`panel-incident-${incident.id}`}>
      {incident.status === 'open' && (
        <div className="space-y-2">
          <Label htmlFor={`incident-notes-${incident.id}`}>Resolution Notes</Label>
          <Textarea id={`incident-notes-${incident.id}`} value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} data-testid={`textarea-resolution-notes-${incident.id}`} />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => review('dismissed')} disabled={reviewMutation.isPending} data-testid={`button-dismiss-${incident.id}`}>
              <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
              Dismiss
            </Button>
            <Button size="sm" onClick={() => review('reviewed')} disabled={reviewMutation.isPending} data-testid={`button-review-${incident.id}`}>
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Mark Reviewed
            </Button>
          </div>
        </div>
      )}

      {incident.status === 'open' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 rounded-md border border-border p-3">
            <Label htmlFor={`mark-missing-qty-${incident.id}`} className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              Mark Missing
            </Label>
            <Input id={`mark-missing-qty-${incident.id}`} type="number" min={0} step="0.01" placeholder="Quantity" value={missingQuantity} onChange={(e) => setMissingQuantity(e.target.value)} data-testid={`input-mark-missing-quantity-${incident.id}`} />
            <Button size="sm" onClick={markMissing} disabled={markMissingMutation.isPending || !missingQuantity} data-testid={`button-mark-missing-${incident.id}`}>
              Confirm Missing
            </Button>
          </div>

          <div className="space-y-2 rounded-md border border-border p-3">
            <Label className="flex items-center gap-2">
              <SearchCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Recover
            </Label>
            <Input type="number" min={0} step="0.01" placeholder="Quantity" value={recoverQuantity} onChange={(e) => setRecoverQuantity(e.target.value)} data-testid={`input-recover-quantity-${incident.id}`} />
            <Select value={recoverStoreId} onValueChange={setRecoverStoreId}>
              <SelectTrigger data-testid={`select-recover-store-${incident.id}`}>
                <SelectValue placeholder="Destination store" />
              </SelectTrigger>
              <SelectContent>
                {(stores ?? []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={recover} disabled={recoverMutation.isPending || !recoverQuantity || !recoverStoreId} data-testid={`button-recover-${incident.id}`}>
              Confirm Recovery
            </Button>
          </div>

          <div className="space-y-2 rounded-md border border-border p-3 sm:col-span-2">
            <Label className="flex items-center gap-2">
              <Archive className="h-3.5 w-3.5" aria-hidden="true" />
              Write Off (this incident's missing quantity)
            </Label>
            <Input type="number" min={0} step="0.01" placeholder="Quantity" value={writeOffQuantity} onChange={(e) => setWriteOffQuantity(e.target.value)} data-testid={`input-writeoff-incident-quantity-${incident.id}`} />
            <Textarea placeholder="Reason (required)" value={writeOffReason} onChange={(e) => setWriteOffReason(e.target.value)} data-testid={`textarea-writeoff-incident-reason-${incident.id}`} />
            <Button size="sm" onClick={writeOffIncident} disabled={writeOffMutation.isPending || !writeOffQuantity || !writeOffReason.trim()} data-testid={`button-writeoff-incident-${incident.id}`}>
              Confirm Write-Off
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function IncidentsTab({ organizationId }: { organizationId: number }) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'open' | 'reviewed' | 'dismissed' | ''>('open');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: items } = useListOfficeInventoryItems(organizationId, {
    query: { queryKey: getListOfficeInventoryItemsQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const itemById = new Map((items ?? []).map((i) => [i.id, i]));

  const { data: incidents, isLoading, error, refetch } = useListOfficeInventoryIncidents(
    organizationId,
    statusFilter ? { status: statusFilter } : undefined,
    { query: { queryKey: getListOfficeInventoryIncidentsQueryKey(organizationId, statusFilter ? { status: statusFilter } : undefined), enabled: organizationId > 0 } },
  );

  const handleChanged = () => {
    queryClient.invalidateQueries({ queryKey: getListOfficeInventoryIncidentsQueryKey(organizationId, statusFilter ? { status: statusFilter } : undefined) });
    refetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Select value={statusFilter || 'all'} onValueChange={(v) => setStatusFilter(v === 'all' ? '' : (v as typeof statusFilter))}>
          <SelectTrigger className="w-44" data-testid="select-incident-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="reviewed">Reviewed</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
          </SelectContent>
        </Select>
        <ReportIncidentDialog organizationId={organizationId} onReported={handleChanged} />
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : error ? (
        <QueryError title="Could not load incidents" message={errorMessage(error) ?? 'Please try again.'} onRetry={() => refetch()} />
      ) : !incidents || incidents.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <ShieldAlert className="h-8 w-8 text-muted-foreground mb-4" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No incidents</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Damage and missing reports will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {incidents.map((incident) => (
            <Card key={incident.id} data-testid={`row-incident-${incident.id}`}>
              <CardContent className="py-4 space-y-3">
                <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setExpandedId(expandedId === incident.id ? null : incident.id)} data-testid={`button-expand-incident-${incident.id}`}>
                  <span className="space-y-1">
                    <span className="block font-medium text-foreground">{itemById.get(incident.itemId)?.name ?? `Item #${incident.itemId}`} — {incident.incidentType}</span>
                    <span className="block text-sm text-muted-foreground">{incident.holderType} #{incident.holderId} · reported {new Date(incident.reportedAt).toLocaleDateString()}</span>
                  </span>
                  <Badge variant={INCIDENT_STATUS_VARIANT[incident.status] ?? 'outline'}>{incident.status}</Badge>
                </button>
                {expandedId === incident.id && <IncidentDetailPanel organizationId={organizationId} incident={incident} onChanged={handleChanged} />}
              </CardContent>
            </Card>
          ))}
        </div>
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
          <TabsTrigger value="receiving" data-testid="tab-receiving">Receiving</TabsTrigger>
          <TabsTrigger value="stock" data-testid="tab-stock">Stock</TabsTrigger>
          <TabsTrigger value="requests" data-testid="tab-requests">My Requests</TabsTrigger>
          <TabsTrigger value="approvals" data-testid="tab-approvals">Approvals</TabsTrigger>
          <TabsTrigger value="issuing" data-testid="tab-issuing">Issuing</TabsTrigger>
          <TabsTrigger value="custody" data-testid="tab-custody">Custody</TabsTrigger>
          <TabsTrigger value="movements" data-testid="tab-movements">Movements</TabsTrigger>
          <TabsTrigger value="incidents" data-testid="tab-incidents">Incidents</TabsTrigger>
          <TabsTrigger value="configuration" data-testid="tab-configuration">Configuration</TabsTrigger>
        </TabsList>
        <TabsContent value="items">
          <ItemsTab organizationId={organizationId} />
        </TabsContent>
        <TabsContent value="stores">
          <StoresTab organizationId={organizationId} />
        </TabsContent>
        <TabsContent value="receiving">
          <ReceivingTab organizationId={organizationId} />
        </TabsContent>
        <TabsContent value="stock">
          <StockTab organizationId={organizationId} />
        </TabsContent>
        <TabsContent value="requests">
          <RequestsTab organizationId={organizationId} />
        </TabsContent>
        <TabsContent value="approvals">
          <ApprovalsTab organizationId={organizationId} />
        </TabsContent>
        <TabsContent value="issuing">
          <IssuingTab organizationId={organizationId} />
        </TabsContent>
        <TabsContent value="custody">
          <CustodyTab organizationId={organizationId} />
        </TabsContent>
        <TabsContent value="movements">
          <MovementsTab organizationId={organizationId} />
        </TabsContent>
        <TabsContent value="incidents">
          <IncidentsTab organizationId={organizationId} />
        </TabsContent>
        <TabsContent value="configuration">
          <ConfigurationTab organizationId={organizationId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
