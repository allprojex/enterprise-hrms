/**
 * WS-26B — stored signature assets.
 *
 * A person's own authorized signature images. `SignatureAssetsManager` lists,
 * uploads and revokes them (self-service); `StoredSignaturePicker` lets a
 * signer choose one to APPLY to a document — always an explicit action, never
 * an automatic stamp. Raw signature images are sensitive and auth-gated, so the
 * UI shows provenance (dimensions, hash, dates) rather than embedding the
 * private image inline; the image itself appears on the rendered document.
 */
import { useRef, useState } from "react";
import {
  useListSignatureAssets,
  useUploadSignatureAsset,
  useRevokeSignatureAsset,
  getListSignatureAssetsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import type { SignatureAssetView } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmActionDialog } from "@/components/foundation";
import { useToast } from "@/hooks/use-toast";

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;

function errorMessage(err: unknown): string {
  const e = err as { response?: { data?: { error?: string } }; message?: string };
  return e?.response?.data?.error ?? e?.message ?? "Something went wrong";
}

function assetLabel(a: SignatureAssetView): string {
  const dims = a.widthPx && a.heightPx ? `${a.widthPx}×${a.heightPx}` : "image";
  return `Signature #${a.id} · ${dims} · uploaded ${new Date(a.uploadedAt).toISOString().slice(0, 10)}`;
}

export function SignatureAssetsManager({ organizationId }: { organizationId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const listQuery = useListSignatureAssets(organizationId, {
    query: { queryKey: getListSignatureAssetsQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const uploadMutation = useUploadSignatureAsset();
  const revokeMutation = useRevokeSignatureAsset();

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListSignatureAssetsQueryKey(organizationId) });

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    if (!ALLOWED.has(file.type)) {
      toast({ title: "Unsupported file", description: "PNG, JPEG or WebP only.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({ title: "File too large", description: "The signature image must be 5MB or smaller.", variant: "destructive" });
      return;
    }
    uploadMutation.mutate(
      { organizationId, data: { file } },
      {
        onSuccess: () => {
          toast({ title: "Signature stored", variant: "success" });
          refresh();
        },
        onError: (err) => toast({ title: "Signature not stored", description: errorMessage(err), variant: "destructive" }),
      },
    );
  };

  const [revokeTarget, setRevokeTarget] = useState<SignatureAssetView | null>(null);

  // Revocation is permanent (there is no reinstate endpoint). The promise is
  // returned so the confirmation stays open on failure.
  const revoke = (assetId: number) =>
    revokeMutation.mutateAsync(
      { organizationId, assetId, data: {} },
      {
        onSuccess: () => {
          toast({ title: "Signature revoked", variant: "success" });
          refresh();
        },
        onError: (err) => toast({ title: "Signature not revoked", description: errorMessage(err), variant: "destructive" }),
      },
    );

  const assets = listQuery.data?.items ?? [];

  return (
    <div className="space-y-4" data-testid="signature-assets-manager">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-heading-sm text-foreground">My signatures</h3>
          <p className="text-helper text-foreground-muted">Store a signature image to apply to documents. Only you can see or use it.</p>
        </div>
        <div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onFile} data-testid="signature-asset-file" />
          <Button type="button" size="sm" onClick={() => fileRef.current?.click()} disabled={uploadMutation.isPending} data-testid="signature-asset-upload">
            {uploadMutation.isPending ? "Uploading…" : "Upload signature"}
          </Button>
        </div>
      </div>

      {listQuery.isLoading ? (
        <p className="text-helper text-foreground-muted">Loading…</p>
      ) : assets.length === 0 ? (
        <p className="text-helper text-foreground-muted" data-testid="signature-assets-empty">
          You have no stored signatures yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {assets.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2" data-testid={`signature-asset-${a.id}`}>
              <div className="min-w-0">
                <p className="truncate text-body-sm text-foreground">{assetLabel(a)}</p>
                <p className="truncate text-helper text-foreground-muted">SHA-256 {a.sha256.slice(0, 16)}…</p>
              </div>
              <div className="flex items-center gap-2">
                {a.status === "revoked" ? (
                  <Badge variant="secondary">Revoked</Badge>
                ) : (
                  <Button type="button" variant="outline" size="sm" onClick={() => setRevokeTarget(a)} disabled={revokeMutation.isPending} data-testid={`signature-asset-revoke-${a.id}`}>
                    Revoke
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmActionDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        title="Revoke signature?"
        description={
          <p>
            {`“${revokeTarget ? assetLabel(revokeTarget) : ""}” can no longer be applied to documents. Documents already signed with it are not changed. This cannot be undone — to sign with a stored image again, upload a new signature.`}
          </p>
        }
        confirmLabel="Revoke Signature"
        onConfirm={() => (revokeTarget ? revoke(revokeTarget.id) : undefined)}
        testId="dialog-revoke-signature-asset"
      />
    </div>
  );
}

/** Inline chooser used when applying a stored signature to a slot. */
export function StoredSignaturePicker({
  organizationId,
  assets,
  loading,
  disabled,
  onPick,
  onBack,
}: {
  organizationId: number;
  assets: SignatureAssetView[];
  loading?: boolean;
  disabled?: boolean;
  onPick: (assetId: number) => void;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadMutation = useUploadSignatureAsset();
  const [justUploaded, setJustUploaded] = useState<number | null>(null);

  const active = assets.filter((a) => a.status === "active");

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    if (!ALLOWED.has(file.type) || file.size > MAX_BYTES) {
      toast({ title: "Unsupported file", description: "PNG, JPEG or WebP up to 5MB.", variant: "destructive" });
      return;
    }
    uploadMutation.mutate(
      { organizationId, data: { file } },
      {
        onSuccess: (created) => {
          setJustUploaded(created.id);
          void queryClient.invalidateQueries({ queryKey: getListSignatureAssetsQueryKey(organizationId) });
          toast({ title: "Signature stored", description: "Select it below to apply it.", variant: "success" });
        },
        onError: (err) => toast({ title: "Signature not stored", description: errorMessage(err), variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-3" data-testid="stored-signature-picker">
      {loading ? (
        <p className="text-helper text-foreground-muted">Loading your stored signatures…</p>
      ) : active.length === 0 ? (
        <p className="text-helper text-foreground-muted">You have no stored signatures. Upload one to apply it.</p>
      ) : (
        <ul className="space-y-2">
          {active.map((a) => (
            <li key={a.id}>
              <Button
                type="button"
                variant={justUploaded === a.id ? "default" : "outline"}
                className="w-full justify-start"
                disabled={disabled}
                onClick={() => onPick(a.id)}
                data-testid={`stored-signature-pick-${a.id}`}
              >
                {assetLabel(a)}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onFile} data-testid="stored-signature-file" />
        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={disabled || uploadMutation.isPending} data-testid="stored-signature-upload">
          {uploadMutation.isPending ? "Uploading…" : "Upload new"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={disabled} data-testid="stored-signature-back">
          Back
        </Button>
      </div>
    </div>
  );
}
