import { Link } from 'wouter';
import { ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/**
 * Shown on an employee record that belongs to the person looking at it.
 *
 * The server refuses every administrative write an HR officer aims at their
 * own record (`self_administration_forbidden`): edits, lifecycle actions,
 * photo, documents, links. Rather than let those controls fail one click at a
 * time, the pages hide them and say why, once.
 *
 * It does not promise that every change is available through My Requests —
 * only personal details are (WS-13's eligible fields); placement and
 * employment changes need another authorized officer. Self-service also
 * depends on the employee_self_service module being enabled, which the link's
 * own route gate reports if it is not.
 */
export function SelfAdministrationNotice({ context = 'profile' }: { context?: 'profile' | 'edit' }) {
  return (
    <Alert data-testid="notice-self-administration" role="status">
      <ShieldAlert className="size-4" aria-hidden="true" />
      <AlertTitle>This is your own employee record</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>
          {context === 'edit'
            ? 'Administrative changes to your own record are not permitted, even for HR officers. '
            : 'HR administrative controls are hidden here because you cannot administer your own record. '}
          Another authorized HR officer or organisation administrator can make changes for you.
        </p>
        <p>
          To correct your own personal details (name, contact information, address, emergency contacts), submit a
          data-change request from{' '}
          <Link href="/my-requests" className="font-medium underline underline-offset-4" data-testid="link-my-requests">
            My Requests
          </Link>
          . Employment and placement changes are not available there.
        </p>
      </AlertDescription>
    </Alert>
  );
}
