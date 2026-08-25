import { useState } from 'react';
import { FileText, Plus, History, Download, Pencil, Upload } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  useListOrganizationDocuments,
  getListOrganizationDocumentsQueryKey,
  useListDocumentCategories,
  getListDocumentCategoriesQueryKey,
  useCreateOrganizationDocument,
  useUpdateOrganizationDocument,
  useAddOrganizationDocumentVersion,
  useListOrganizationDocumentVersions,
  getListOrganizationDocumentVersionsQueryKey,
  downloadOrganizationDocumentVersion,
  useGetMe,
  getGetMeQueryKey,
  type OrganizationDocument,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { useIsHrCapable } from '@/hooks/use-hr-capable';
import { QueryError } from '@/components/query-error';

const ALL = '__all__';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Downloads stream through the authenticated API route (never a public URL),
 * so the response arrives as a Blob rather than something an <a href> could
 * fetch on its own — hence the temporary object URL.
 */
async function saveBlob(blob: Blob, fileName: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Version history for one document, loaded only while the dialog is open. */
function VersionHistoryDialog({
  organizationId,
  document,
  onClose,
}: {
  organizationId: number;
  document: OrganizationDocument;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const {
    data: versions,
    isLoading,
    error,
    refetch,
  } = useListOrganizationDocumentVersions(organizationId, document.id, {
    query: { queryKey: getListOrganizationDocumentVersionsQueryKey(organizationId, document.id) },
  });

  const handleDownload = async (versionId: number, fileName: string) => {
    try {
      const blob = await downloadOrganizationDocumentVersion(organizationId, document.id, versionId);
      await saveBlob(blob, fileName);
    } catch (err) {
      toast({ title: 'Could not download document', description: errorMessage(err), variant: 'destructive' });
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription>
            {document.title} — superseded versions are retained and remain downloadable.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2 py-4" aria-busy="true" aria-label="Loading version history">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <QueryError title="Failed to load versions" message="Could not fetch version history." onRetry={() => refetch()} />
        ) : (
          <Table aria-label="Version history">
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Change note</TableHead>
                <TableHead className="text-right">Download</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(versions ?? []).map((version) => (
                <TableRow key={version.id} data-testid={`row-version-${version.id}`}>
                  <TableCell className="font-medium">v{version.versionNumber}</TableCell>
                  <TableCell className="max-w-[16rem] truncate">{version.fileName}</TableCell>
                  <TableCell>{formatSize(version.fileSize)}</TableCell>
                  <TableCell>
                    <Badge variant={version.status === 'current' ? 'secondary' : 'outline'} className="capitalize">
                      {version.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[14rem] truncate text-muted-foreground">
                    {version.changeNote ?? '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDownload(version.id, version.fileName)}
                      data-testid={`button-download-version-${version.id}`}
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function OrganizationDocuments() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  // Role-shaped gate, matching every other HR-administration surface in this
  // app. The backend remains the real authority — organization_document.read
  // for the list, organization_document.manage for everything below.
  const isHrCapable = useIsHrCapable(organizationId);

  const [categoryFilter, setCategoryFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [search, setSearch] = useState('');
  const [expiringBefore, setExpiringBefore] = useState('');

  const params = {
    ...(categoryFilter !== ALL ? { categoryCode: categoryFilter } : {}),
    ...(statusFilter !== ALL ? { status: statusFilter as 'active' | 'archived' } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(expiringBefore ? { expiringBefore } : {}),
  };

  const {
    data: documents,
    isLoading,
    error,
    refetch,
  } = useListOrganizationDocuments(organizationId, params, {
    query: {
      queryKey: getListOrganizationDocumentsQueryKey(organizationId, params),
      enabled: organizationId > 0,
    },
  });

  const { data: categories } = useListDocumentCategories(organizationId, {
    query: { queryKey: getListDocumentCategoriesQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const createMutation = useCreateOrganizationDocument();
  const updateMutation = useUpdateOrganizationDocument();
  const addVersionMutation = useAddOrganizationDocumentVersion();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newEffectiveDate, setNewEffectiveDate] = useState('');
  const [newExpiryDate, setNewExpiryDate] = useState('');
  const [newFile, setNewFile] = useState<File | null>(null);

  const [historyFor, setHistoryFor] = useState<OrganizationDocument | null>(null);

  const [editDoc, setEditDoc] = useState<OrganizationDocument | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const [versionFor, setVersionFor] = useState<OrganizationDocument | null>(null);
  const [versionFile, setVersionFile] = useState<File | null>(null);
  const [versionNote, setVersionNote] = useState('');
  const [versionEffectiveDate, setVersionEffectiveDate] = useState('');
  const [versionExpiryDate, setVersionExpiryDate] = useState('');

  const invalidateDocuments = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/organizations/${organizationId}/documents`] });
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFile || !newCategory || !newTitle.trim()) return;
    createMutation.mutate(
      {
        organizationId,
        data: {
          file: newFile,
          categoryCode: newCategory,
          title: newTitle.trim(),
          ...(newDescription.trim() ? { description: newDescription.trim() } : {}),
          ...(newEffectiveDate ? { effectiveDate: newEffectiveDate } : {}),
          ...(newExpiryDate ? { expiryDate: newExpiryDate } : {}),
        },
      },
      {
        onSuccess: () => {
          invalidateDocuments();
          setUploadOpen(false);
          setNewCategory('');
          setNewTitle('');
          setNewDescription('');
          setNewEffectiveDate('');
          setNewExpiryDate('');
          setNewFile(null);
          toast({ title: 'Document uploaded' });
        },
        onError: (err) => {
          toast({
            title: 'Could not upload document',
            description: errorMessage(err) ?? 'Please check the details and try again.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editDoc) return;
    updateMutation.mutate(
      {
        organizationId,
        documentId: editDoc.id,
        data: { title: editTitle.trim(), description: editDescription.trim() || null },
      },
      {
        onSuccess: () => {
          invalidateDocuments();
          setEditDoc(null);
          toast({ title: 'Document updated' });
        },
        onError: (err) => {
          toast({ title: 'Could not update document', description: errorMessage(err), variant: 'destructive' });
        },
      },
    );
  };

  const handleVersionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!versionFor || !versionFile) return;
    addVersionMutation.mutate(
      {
        organizationId,
        documentId: versionFor.id,
        data: {
          file: versionFile,
          ...(versionNote.trim() ? { changeNote: versionNote.trim() } : {}),
          ...(versionEffectiveDate ? { effectiveDate: versionEffectiveDate } : {}),
          ...(versionExpiryDate ? { expiryDate: versionExpiryDate } : {}),
        },
      },
      {
        onSuccess: () => {
          invalidateDocuments();
          queryClient.invalidateQueries({
            queryKey: getListOrganizationDocumentVersionsQueryKey(organizationId, versionFor.id),
          });
          setVersionFor(null);
          setVersionFile(null);
          setVersionNote('');
          setVersionEffectiveDate('');
          setVersionExpiryDate('');
          toast({ title: 'New version uploaded' });
        },
        onError: (err) => {
          toast({
            title: 'Could not upload new version',
            description: errorMessage(err) ?? 'Please try again.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleDownloadCurrent = async (document: OrganizationDocument) => {
    if (!document.currentVersion) return;
    try {
      const blob = await downloadOrganizationDocumentVersion(organizationId, document.id, document.currentVersion.id);
      await saveBlob(blob, document.currentVersion.fileName);
    } catch (err) {
      toast({ title: 'Could not download document', description: errorMessage(err), variant: 'destructive' });
    }
  };

  const categoryLabel = (code: string) => categories?.find((c) => c.categoryCode === code)?.label ?? code;

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">Documents &amp; Records</h1>
          <p className="text-muted-foreground">
            Organisation-level documents such as handbooks, policies, forms, and procedures
          </p>
        </div>
        {isHrCapable && (
          <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-document">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Upload Document
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleCreate}>
                <DialogHeader>
                  <DialogTitle>Upload Document</DialogTitle>
                  <DialogDescription>PDF, JPEG, PNG, DOCX, or XLSX. Maximum 10MB.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="document-category">Category</Label>
                    <Select value={newCategory} onValueChange={setNewCategory}>
                      <SelectTrigger id="document-category" data-testid="select-document-category">
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                      <SelectContent>
                        {(categories ?? []).map((category) => (
                          <SelectItem key={category.categoryCode} value={category.categoryCode}>
                            {category.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="document-title">Title</Label>
                    <Input
                      id="document-title"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      required
                      data-testid="input-document-title"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="document-description">Description</Label>
                    <Textarea
                      id="document-description"
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      data-testid="input-document-description"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="document-effective-date">Effective date</Label>
                      <Input
                        id="document-effective-date"
                        type="date"
                        value={newEffectiveDate}
                        onChange={(e) => setNewEffectiveDate(e.target.value)}
                        data-testid="input-document-effective-date"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="document-expiry-date">Expiry date</Label>
                      <Input
                        id="document-expiry-date"
                        type="date"
                        value={newExpiryDate}
                        onChange={(e) => setNewExpiryDate(e.target.value)}
                        data-testid="input-document-expiry-date"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="document-file">File</Label>
                    <Input
                      id="document-file"
                      type="file"
                      onChange={(e) => setNewFile(e.target.files?.[0] ?? null)}
                      required
                      data-testid="input-document-file"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending || !newFile || !newCategory}
                    data-testid="button-submit-document"
                  >
                    {createMutation.isPending ? 'Uploading…' : 'Upload Document'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardContent className="grid gap-4 p-4 md:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="filter-search">Search</Label>
            <Input
              id="filter-search"
              placeholder="Search titles…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-filter-search"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="filter-category">Category</Label>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger id="filter-category" data-testid="select-filter-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {(categories ?? []).map((category) => (
                  <SelectItem key={category.categoryCode} value={category.categoryCode}>
                    {category.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="filter-status">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger id="filter-status" data-testid="select-filter-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="filter-expiring">Expiring before</Label>
            <Input
              id="filter-expiring"
              type="date"
              value={expiringBefore}
              onChange={(e) => setExpiringBefore(e.target.value)}
              data-testid="input-filter-expiring"
            />
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading documents">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : error ? (
        <QueryError
          title="Failed to load documents"
          message="Could not fetch documents. Try again."
          onRetry={() => refetch()}
        />
      ) : !documents || documents.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <FileText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No documents yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Upload your first organisation document to start building the records repository.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table aria-label="Organisation documents">
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((document) => (
                <TableRow key={document.id} data-testid={`row-document-${document.id}`}>
                  <TableCell className="font-medium">{document.title}</TableCell>
                  <TableCell>{categoryLabel(document.categoryCode)}</TableCell>
                  <TableCell className="font-mono text-sm">
                    {document.currentVersion ? `v${document.currentVersion.versionNumber}` : '—'}
                  </TableCell>
                  <TableCell>{document.currentVersion?.effectiveDate ?? '—'}</TableCell>
                  <TableCell>{document.currentVersion?.expiryDate ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={document.status === 'active' ? 'secondary' : 'outline'} className="capitalize">
                      {document.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownloadCurrent(document)}
                        disabled={!document.currentVersion}
                        title="Download current version"
                        data-testid={`button-download-document-${document.id}`}
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setHistoryFor(document)}
                        title="Version history"
                        data-testid={`button-history-document-${document.id}`}
                      >
                        <History className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      {isHrCapable && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setVersionFor(document)}
                            title="Upload new version"
                            data-testid={`button-new-version-${document.id}`}
                          >
                            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditDoc(document);
                              setEditTitle(document.title);
                              setEditDescription(document.description ?? '');
                            }}
                            title="Edit details"
                            data-testid={`button-edit-document-${document.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {historyFor && (
        <VersionHistoryDialog
          organizationId={organizationId}
          document={historyFor}
          onClose={() => setHistoryFor(null)}
        />
      )}

      <Dialog open={editDoc !== null} onOpenChange={(open) => !open && setEditDoc(null)}>
        <DialogContent>
          <form onSubmit={handleEditSubmit}>
            <DialogHeader>
              <DialogTitle>Edit Document</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-document-title">Title</Label>
                <Input
                  id="edit-document-title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  required
                  data-testid="input-edit-document-title"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-document-description">Description</Label>
                <Textarea
                  id="edit-document-description"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  data-testid="input-edit-document-description"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={updateMutation.isPending} data-testid="button-submit-edit-document">
                {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={versionFor !== null} onOpenChange={(open) => !open && setVersionFor(null)}>
        <DialogContent>
          <form onSubmit={handleVersionSubmit}>
            <DialogHeader>
              <DialogTitle>Upload New Version</DialogTitle>
              <DialogDescription>
                The current version is superseded but retained — it stays downloadable from version history.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="version-file">File</Label>
                <Input
                  id="version-file"
                  type="file"
                  onChange={(e) => setVersionFile(e.target.files?.[0] ?? null)}
                  required
                  data-testid="input-version-file"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="version-note">Change note</Label>
                <Textarea
                  id="version-note"
                  value={versionNote}
                  onChange={(e) => setVersionNote(e.target.value)}
                  placeholder="What changed in this version?"
                  data-testid="input-version-note"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="version-effective-date">Effective date</Label>
                  <Input
                    id="version-effective-date"
                    type="date"
                    value={versionEffectiveDate}
                    onChange={(e) => setVersionEffectiveDate(e.target.value)}
                    data-testid="input-version-effective-date"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="version-expiry-date">Expiry date</Label>
                  <Input
                    id="version-expiry-date"
                    type="date"
                    value={versionExpiryDate}
                    onChange={(e) => setVersionExpiryDate(e.target.value)}
                    data-testid="input-version-expiry-date"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={addVersionMutation.isPending || !versionFile}
                data-testid="button-submit-version"
              >
                {addVersionMutation.isPending ? 'Uploading…' : 'Upload Version'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
