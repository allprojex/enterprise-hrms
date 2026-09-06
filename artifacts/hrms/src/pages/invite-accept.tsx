import { useState, useEffect } from 'react';
import { useParams, Link, useLocation } from 'wouter';
import { Building2, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useGetInvitation, getGetInvitationQueryKey, useAcceptInvitation } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { applyTenantTheme, type TenantThemeInput } from '@/lib/tenant-theme-tokens';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

export default function InviteAccept() {
  const { token = '' } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);

  const { data: invitation, isLoading, error } = useGetInvitation(token, {
    query: { queryKey: getGetInvitationQueryKey(token), enabled: !!token },
  });
  const acceptMutation = useAcceptInvitation();

  // The INVITATION decides the organization. Apply the invited organization's
  // own theme tokens on this page only (scoped to the invite root element),
  // regardless of which hostname the link was opened on -- an Org A invitation
  // never picks up Org B's branding. Cleared on unmount.
  const brand = invitation?.organization ?? null;
  const orgName = brand?.organizationName ?? invitation?.organizationName ?? 'your organisation';
  const systemName = brand?.systemDisplayName ?? 'Enterprise HRMS';
  const logoUrl = brand?.logoUrl ?? null;
  useEffect(() => {
    const root = document.documentElement;
    const theme = (brand?.theme ?? null) as TenantThemeInput | null;
    if (!theme) return;
    // Same mapping, derivation and readability clamp as the hostname-driven
    // TenantTheme component — one rule set for every tenant-branded surface.
    const applied = applyTenantTheme(root, theme, { dark: root.classList.contains('dark') });
    return () => {
      for (const cssVar of applied) root.style.removeProperty(cssVar);
    };
  }, [brand]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    acceptMutation.mutate(
      { token, data: { firstName: firstName.trim(), lastName: lastName.trim(), password } },
      {
        onSuccess: () => setAccepted(true),
        onError: (err) =>
          toast({
            title: 'Could not accept invitation',
            description: errorMessage(err) ?? 'Please try again.',
            variant: 'destructive',
          }),
      },
    );
  };

  return (
    <div className="min-h-screen w-full flex">
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary via-primary/90 to-accent p-12 flex-col justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white">
            <Building2 className="h-7 w-7 text-primary" />
          </div>
          {logoUrl ? (
            <img src={logoUrl} alt="" className="h-8 w-8 rounded-md bg-white object-contain" />
          ) : null}
          <h1 className="text-xl font-semibold text-white font-sans">{systemName}</h1>
        </div>
        <div className="space-y-6">
          <h2 className="text-4xl font-bold text-white leading-tight">You've been invited to join {orgName}</h2>
          <p className="text-lg text-white/90 leading-relaxed max-w-md">
            Set a password to finish creating your account and join {orgName}.
          </p>
        </div>
        <div className="text-sm text-white/70">© {new Date().getFullYear()} {systemName}. All rights reserved.</div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center justify-center gap-3 mb-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
              <Building2 className="h-7 w-7 text-primary-foreground" />
            </div>
            <h1 className="text-xl font-semibold text-foreground font-sans">{systemName}</h1>
          </div>

          {isLoading ? (
            <div className="space-y-4" aria-busy="true" aria-label="Loading invitation">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : error || !invitation ? (
            <div className="space-y-6 text-center">
              <div className="flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                  <XCircle className="h-8 w-8 text-destructive" />
                </div>
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-foreground">Invalid invitation link</h2>
                <p className="text-muted-foreground">This link doesn't match any pending invitation.</p>
              </div>
              <Link href="/login" data-testid="link-return-login">
                <Button variant="outline" className="w-full">
                  Return to login
                </Button>
              </Link>
            </div>
          ) : invitation.status === 'expired' ? (
            <div className="space-y-4 text-center">
              <h2 className="text-2xl font-bold text-foreground">This invitation has expired</h2>
              <p className="text-muted-foreground">Ask an administrator at {invitation.organizationName} to invite you again.</p>
            </div>
          ) : invitation.status === 'revoked' ? (
            <div className="space-y-4 text-center">
              <h2 className="text-2xl font-bold text-foreground">This invitation is no longer valid</h2>
              <p className="text-muted-foreground">
                Ask an administrator at {orgName} to send you a new invitation.
              </p>
              <Link href="/login" data-testid="link-return-login">
                <Button variant="outline" className="w-full">Return to login</Button>
              </Link>
            </div>
          ) : invitation.status === 'accepted' ? (
            <div className="space-y-6 text-center">
              <h2 className="text-2xl font-bold text-foreground">This invitation was already used</h2>
              <p className="text-muted-foreground">
                If this is your account, log in instead. Otherwise ask {orgName} for a new invitation.
              </p>
              <Link href="/login" data-testid="link-return-login">
                <Button className="w-full">Go to login</Button>
              </Link>
            </div>
          ) : accepted ? (
            <div className="space-y-6 text-center">
              <div className="flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
                  <CheckCircle className="h-8 w-8 text-accent" />
                </div>
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-foreground">Account created</h2>
                <p className="text-muted-foreground">You can now log in to {invitation.organizationName}.</p>
              </div>
              <Button className="w-full" onClick={() => setLocation('/login')} data-testid="button-go-to-login">
                Go to login
              </Button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-2 text-center lg:text-left">
                <h2 className="text-3xl font-bold text-foreground">Join {orgName}</h2>
                <p className="text-muted-foreground">
                  Create your account for <span className="font-medium text-foreground">{invitation.email}</span>
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4" data-testid="form-accept-invitation">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First name</Label>
                    <Input
                      id="firstName"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      required
                      disabled={acceptMutation.isPending}
                      data-testid="input-first-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last name</Label>
                    <Input
                      id="lastName"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      required
                      disabled={acceptMutation.isPending}
                      data-testid="input-last-name"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    required
                    disabled={acceptMutation.isPending}
                    data-testid="input-password"
                  />
                </div>

                <Button type="submit" className="w-full" disabled={acceptMutation.isPending} data-testid="button-submit">
                  {acceptMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating account...
                    </>
                  ) : (
                    'Create account'
                  )}
                </Button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
