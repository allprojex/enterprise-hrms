/**
 * WS-26B — SignatureField.
 *
 * One signature slot in the context of a submission. It shows the applied
 * signature's provenance when signed, or — when the viewer is the authorized
 * signer for the slot and the form is at the right stage — a Sign action that
 * opens a capture dialog. The available methods are exactly those the slot's
 * signature policy permits AND the browser/device can actually do (device
 * adapters are shells until one is installed, so that tab stays disabled).
 *
 * Authorization is ultimately enforced server-side; this component only offers
 * the action. Applying a stored signature is always an explicit choice here —
 * a stored image is never stamped automatically.
 */
import { useMemo, useState } from "react";
import {
  useApplyFormSubmissionSignature,
  useListSignatureAssets,
  getListSignatureAssetsQueryKey,
} from "@workspace/api-client-react";
import type { FormSignatureView } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { SignaturePad } from "./signature-pad";
import { StoredSignaturePicker } from "./signature-assets-manager";
import { defaultSignatureRegistry, type SignatureMethod } from "./signature-providers";

export interface SignatureFieldProps {
  organizationId: number;
  submissionId: number;
  slotKey: string;
  slotLabel: string;
  allowedMethods: SignatureMethod[];
  applied?: FormSignatureView | null;
  canSign: boolean;
  onChanged?: () => void;
}

function errorMessage(err: unknown): string {
  const e = err as { response?: { data?: { error?: string } }; message?: string };
  return e?.response?.data?.error ?? e?.message ?? "Something went wrong";
}

export function SignatureField({ organizationId, submissionId, slotKey, slotLabel, allowedMethods, applied, canSign, onChanged }: SignatureFieldProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<SignatureMethod | null>(null);

  // Which of the permitted methods are actually offerable in this environment.
  const [offerable, setOfferable] = useState<SignatureMethod[] | null>(null);
  useMemo(() => {
    void defaultSignatureRegistry.available(allowedMethods).then((ps) => {
      const methods = [...new Set(ps.map((p) => p.method))].filter((m) => allowedMethods.includes(m));
      setOfferable(methods);
    });
  }, [allowedMethods]);

  const assetsQuery = useListSignatureAssets(organizationId, {
    query: { queryKey: getListSignatureAssetsQueryKey(organizationId), enabled: open && method === "uploaded" && organizationId > 0 },
  });
  const applyMutation = useApplyFormSubmissionSignature();

  const isSigned = applied != null && !applied.revokedAt;

  const close = () => {
    setOpen(false);
    setMethod(null);
  };

  const doApply = (data: { slotKey: string; method: SignatureMethod; file?: Blob; sourceAssetId?: number }) => {
    applyMutation.mutate(
      { organizationId, submissionId, data },
      {
        onSuccess: () => {
          toast({ title: "Signature applied", variant: "success" });
          close();
          onChanged?.();
        },
        onError: (err) => toast({ title: "Signature not applied", description: errorMessage(err), variant: "destructive" }),
      },
    );
  };

  if (isSigned) {
    return (
      <div className="rounded-md border border-border bg-surface px-3 py-3" data-testid={`signature-applied-${slotKey}`}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-label text-foreground">{slotLabel}</p>
          <Badge variant="success">Signed</Badge>
        </div>
        <p className="text-helper text-foreground-muted">
          {applied!.authority} · {applied!.method} · {new Date(applied!.signedAt).toISOString().slice(0, 19).replace("T", " ")} UTC
        </p>
        <p className="text-helper text-foreground-muted">Integrity SHA-256 {applied!.sha256.slice(0, 16)}…</p>
      </div>
    );
  }

  if (!canSign) {
    return (
      <div className="rounded-md border border-dashed border-border-strong bg-surface-muted px-3 py-3" data-testid={`signature-pending-${slotKey}`}>
        <p className="text-label text-foreground">{slotLabel}</p>
        <p className="text-helper text-foreground-muted">Awaiting signature. The placeholder is printed on the form until it is signed.</p>
      </div>
    );
  }

  const methods = offerable ?? [];

  return (
    <div className="rounded-md border border-border-strong bg-surface px-3 py-3" data-testid={`signature-field-${slotKey}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-label text-foreground">{slotLabel}</p>
        <Button type="button" size="sm" onClick={() => setOpen(true)} data-testid={`signature-sign-${slotKey}`}>
          Sign
        </Button>
      </div>
      <p className="text-helper text-foreground-muted">You are authorized to sign this slot. Your signature is applied only when you confirm.</p>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-w-lg" data-testid={`signature-dialog-${slotKey}`}>
          <DialogHeader>
            <DialogTitle>Sign: {slotLabel}</DialogTitle>
            <DialogDescription>Choose how to sign. Your signature is applied only when you confirm.</DialogDescription>
          </DialogHeader>

          {method == null && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Signature method">
              {methods.includes("drawn") && (
                <Button type="button" variant="outline" onClick={() => setMethod("drawn")} data-testid={`signature-method-drawn-${slotKey}`}>
                  Draw
                </Button>
              )}
              {methods.includes("uploaded") && (
                <Button type="button" variant="outline" onClick={() => setMethod("uploaded")} data-testid={`signature-method-uploaded-${slotKey}`}>
                  Use a stored signature
                </Button>
              )}
              {allowedMethods.includes("device") && !methods.includes("device") && (
                <p className="text-helper text-foreground-muted" data-testid={`signature-device-unavailable-${slotKey}`}>
                  No signature device is connected. Connect a supported device, or draw / upload instead.
                </p>
              )}
              {methods.length === 0 && !allowedMethods.includes("device") && (
                <p className="text-helper text-foreground-muted">No signing method is available for this slot in this browser.</p>
              )}
            </div>
          )}

          {method === "drawn" && (
            <SignaturePad
              disabled={applyMutation.isPending}
              onCancel={() => setMethod(null)}
              confirmLabel="Apply signature"
              onConfirm={(blob) => doApply({ slotKey, method: "drawn", file: blob })}
            />
          )}

          {method === "uploaded" && (
            <StoredSignaturePicker
              organizationId={organizationId}
              assets={assetsQuery.data?.items ?? []}
              loading={assetsQuery.isLoading}
              disabled={applyMutation.isPending}
              onBack={() => setMethod(null)}
              onPick={(assetId) => doApply({ slotKey, method: "uploaded", sourceAssetId: assetId })}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
