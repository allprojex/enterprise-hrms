import { useState } from 'react';
import { CheckCircle2, XCircle, Link2, Clock, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  useGetOfferVersionState,
  getGetOfferVersionStateQueryKey,
  useRecordOfferResponse,
  useIssueOfferResponseLink,
} from '@workspace/api-client-react';

function errorMessage(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? (err instanceof Error ? err.message : fallback);
}

/**
 * WS-9 — the offer response panel.
 *
 * Statuses are shown as distinct business events rather than collapsed into
 * one ambiguous "approved": an offer that is approved, issued, accepted,
 * declined, withdrawn, expired or superseded means something different at each
 * step, and the conversion gate depends on the difference.
 *
 * Controls are rendered from the server's own `canRespond` decision, not from
 * a client-side guess — the backend remains authoritative and would refuse
 * anyway, but showing an action that cannot succeed is its own defect.
 */
interface OfferResponsePanelProps {
  organizationId: number;
  offerVersionId: number;
  /** Hides mutating controls for a caller who cannot act. */
  readOnly?: boolean;
}

export function OfferResponsePanel({ organizationId, offerVersionId, readOnly }: OfferResponsePanelProps) {
  const { toast } = useToast();
  const [issuedLink, setIssuedLink] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');

  const enabled = organizationId > 0 && offerVersionId > 0;
  const query = useGetOfferVersionState(organizationId, offerVersionId, {
    query: { queryKey: getGetOfferVersionStateQueryKey(organizationId, offerVersionId), enabled },
  });
  const respondMutation = useRecordOfferResponse();
  const linkMutation = useIssueOfferResponseLink();

  if (!enabled || query.isLoading || !query.data) return null;
  const state = query.data;
  const response = state.response;

  const respond = (responseType: 'accepted' | 'declined') => {
    respondMutation.mutate(
      { organizationId, versionId: offerVersionId, data: { responseType, reason: responseType === 'declined' ? declineReason || null : null } },
      {
        onSuccess: () => {
          void query.refetch();
          setDeclineReason('');
          toast({ title: responseType === 'accepted' ? 'Acceptance recorded' : 'Decline recorded' });
        },
        onError: (err) => toast({ title: 'Could not record response', description: errorMessage(err, ''), variant: 'destructive' }),
      },
    );
  };

  return (
    <Card data-testid="offer-response-panel">
      <CardHeader>
        <CardTitle className="text-base">Candidate Response</CardTitle>
        <CardDescription>
          {response
            ? 'This version has reached a final response. A later revision would need its own response.'
            : state.canRespond
              ? 'Record what the candidate decided, or send them a secure response link.'
              : 'This version is not currently awaiting a candidate response.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="capitalize">
            {String((state.version as { status?: string }).status ?? '')}
          </Badge>
          {state.isExpired && (
            <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-900">
              <Clock className="h-3 w-3" aria-hidden="true" />
              Expired
            </Badge>
          )}
          {!state.isCurrent && (
            <Badge variant="secondary" className="gap-1 bg-muted">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              Not the current version
            </Badge>
          )}
        </div>

        {response && (
          <div className="rounded-md border p-3 text-sm">
            <p className="font-medium capitalize">{response.responseType}</p>
            <p className="text-muted-foreground">
              {new Date(response.respondedAt).toLocaleString()} ·{' '}
              {response.channel === 'candidate_token' ? 'by the candidate' : 'recorded by staff'}
            </p>
            {response.reason && <p className="mt-1 text-muted-foreground">{response.reason}</p>}
          </div>
        )}

        {!readOnly && state.canRespond && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => respond('accepted')} disabled={respondMutation.isPending}>
                <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Record acceptance
              </Button>
              <Button variant="outline" onClick={() => respond('declined')} disabled={respondMutation.isPending}>
                <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                Record decline
              </Button>
              <Button
                variant="outline"
                disabled={linkMutation.isPending}
                onClick={() =>
                  linkMutation.mutate(
                    { organizationId, versionId: offerVersionId },
                    {
                      onSuccess: (result) => {
                        setIssuedLink(result.token);
                        toast({ title: 'Response link issued', description: 'Copy it now — it is shown only once.' });
                      },
                      onError: (err) => toast({ title: 'Could not issue link', description: errorMessage(err, ''), variant: 'destructive' }),
                    },
                  )
                }
              >
                <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Issue response link
              </Button>
            </div>

            <div>
              <Label htmlFor="decline-reason">Decline reason (optional)</Label>
              <Input id="decline-reason" value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} />
            </div>
          </div>
        )}

        {issuedLink && (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
            <p className="text-sm font-medium text-blue-900">Response link — shown once</p>
            <p className="mt-1 break-all font-mono text-xs text-blue-900">/offer-response/{issuedLink}</p>
            <p className="mt-1 text-xs text-blue-900">
              Single use, tied to this version only, and expires. Issuing another link invalidates this one.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
