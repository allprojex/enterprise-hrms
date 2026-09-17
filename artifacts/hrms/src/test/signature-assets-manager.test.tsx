/**
 * WS-26B — revoking a stored signature is confirmed first.
 *
 * Revocation is a permanent status change (there is no reinstate endpoint), so
 * the click opens a confirmation and nothing is sent until it is confirmed.
 * Hooks are mocked at the @workspace/api-client-react level.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { SignatureAssetsManager } from '@/components/signature/signature-assets-manager';

const { outcome, revokeAsync, toastSpy } = vi.hoisted(() => {
  const outcome = { fail: false };
  return {
    outcome,
    toastSpy: vi.fn(),
    revokeAsync: vi.fn((_vars: unknown, opts?: { onSuccess?: () => void; onError?: (e: unknown) => void }) => {
      if (outcome.fail) {
        const err = new Error('Signature asset not found');
        opts?.onError?.(err);
        return Promise.reject(err);
      }
      opts?.onSuccess?.();
      return Promise.resolve({});
    }),
  };
});

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastSpy }) }));

vi.mock('@workspace/api-client-react', () => ({
  useListSignatureAssets: () => ({
    data: {
      items: [
        {
          id: 12,
          status: 'active',
          widthPx: 400,
          heightPx: 200,
          uploadedAt: '2026-09-01T10:00:00.000Z',
          sha256: 'abcdef0123456789abcdef0123456789',
        },
      ],
    },
    isLoading: false,
  }),
  getListSignatureAssetsQueryKey: (o: number) => ['signatureAssets', o],
  useUploadSignatureAsset: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeSignatureAsset: () => ({ mutate: vi.fn(), mutateAsync: revokeAsync, isPending: false }),
}));

const DIALOG = 'dialog-revoke-signature-asset';

function renderManager() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SignatureAssetsManager organizationId={10} />
    </QueryClientProvider>,
  );
}

describe('SignatureAssetsManager — revoke confirmation', () => {
  beforeEach(() => {
    outcome.fail = false;
    revokeAsync.mockClear();
    toastSpy.mockClear();
  });

  it('asks before revoking, and Cancel revokes nothing', async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByTestId('signature-asset-revoke-12'));
    const dialog = screen.getByTestId(DIALOG);
    expect(dialog).toHaveTextContent('Revoke signature?');
    expect(dialog).toHaveTextContent('can no longer be applied to documents');
    expect(dialog).toHaveTextContent('Documents already signed with it are not changed.');
    expect(revokeAsync).not.toHaveBeenCalled();

    await user.click(screen.getByTestId(`${DIALOG}-cancel`));
    await waitFor(() => expect(screen.queryByTestId(DIALOG)).toBeNull());
    expect(revokeAsync).not.toHaveBeenCalled();
  });

  it('revokes exactly once on confirm, then closes and reports success', async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByTestId('signature-asset-revoke-12'));
    await user.click(screen.getByTestId(`${DIALOG}-confirm`));

    await waitFor(() => expect(screen.queryByTestId(DIALOG)).toBeNull());
    expect(revokeAsync).toHaveBeenCalledTimes(1);
    expect(revokeAsync.mock.calls[0]![0]).toEqual({ organizationId: 10, assetId: 12, data: {} });
    expect(toastSpy).toHaveBeenCalledWith({ title: 'Signature revoked', variant: 'success' });
  });

  it('keeps the dialog open and the signature listed when revoking fails', async () => {
    const user = userEvent.setup();
    outcome.fail = true;
    renderManager();

    await user.click(screen.getByTestId('signature-asset-revoke-12'));
    await user.click(screen.getByTestId(`${DIALOG}-confirm`));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Signature not revoked', variant: 'destructive' })),
    );
    expect(screen.getByTestId(DIALOG)).toBeInTheDocument();
    expect(screen.getByTestId('signature-asset-12')).toBeInTheDocument();
  });
});
