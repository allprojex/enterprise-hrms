import { useState } from 'react';
import { useParams, Link, useLocation } from 'wouter';
import { Building2, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/foundation';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useGetPasswordResetStatus, getGetPasswordResetStatusQueryKey, useResetPassword } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

export default function ResetPassword() {
  const { token = '' } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [reset, setReset] = useState(false);

  const { data: status, isLoading, error } = useGetPasswordResetStatus(token, {
    query: { queryKey: getGetPasswordResetStatusQueryKey(token), enabled: !!token },
  });
  const resetMutation = useResetPassword();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    resetMutation.mutate(
      { token, data: { password } },
      {
        onSuccess: () => setReset(true),
        onError: (err) =>
          toast({
            title: 'Could not reset password',
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
          <h1 className="text-xl font-semibold text-white font-sans">Enterprise HRMS</h1>
        </div>
        <div className="space-y-6">
          <h2 className="text-4xl font-bold text-white leading-tight">Set a new password</h2>
          <p className="text-lg text-white/90 leading-relaxed max-w-md">
            Choose a new password to regain access to your account.
          </p>
        </div>
        <div className="text-sm text-white/70">© {new Date().getFullYear()} Enterprise HRMS. All rights reserved.</div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center justify-center gap-3 mb-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
              <Building2 className="h-7 w-7 text-primary-foreground" />
            </div>
            <h1 className="text-xl font-semibold text-foreground font-sans">Enterprise HRMS</h1>
          </div>

          {isLoading ? (
            <div className="space-y-4" aria-busy="true" aria-label="Loading reset link">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : error || !status || status.status === 'invalid' ? (
            <div className="space-y-6 text-center">
              <div className="flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                  <XCircle className="h-8 w-8 text-destructive" />
                </div>
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-foreground">Invalid reset link</h2>
                <p className="text-muted-foreground">This link doesn't match any pending password reset.</p>
              </div>
              <Link href="/forgot-password" data-testid="link-request-new">
                <Button variant="outline" className="w-full">
                  Request a new link
                </Button>
              </Link>
            </div>
          ) : status.status === 'expired' ? (
            <div className="space-y-6 text-center">
              <h2 className="text-2xl font-bold text-foreground">This reset link has expired</h2>
              <p className="text-muted-foreground">Request a new one to continue.</p>
              <Link href="/forgot-password" data-testid="link-request-new">
                <Button className="w-full">Request a new link</Button>
              </Link>
            </div>
          ) : reset ? (
            <div className="space-y-6 text-center">
              <div className="flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
                  <CheckCircle className="h-8 w-8 text-accent" />
                </div>
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-foreground">Password reset</h2>
                <p className="text-muted-foreground">You can now log in with your new password.</p>
              </div>
              <Button className="w-full" onClick={() => setLocation('/login')} data-testid="button-go-to-login">
                Go to login
              </Button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-2 text-center lg:text-left">
                <h2 className="text-3xl font-bold text-foreground">Set a new password</h2>
                <p className="text-muted-foreground">Choose a new password for your account.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4" data-testid="form-reset-password">
                <div className="space-y-2">
                  <Label htmlFor="password">New password</Label>
                  <PasswordInput
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    required
                    autoComplete="new-password"
                    disabled={resetMutation.isPending}
                    data-testid="input-password"
                  />
                </div>

                <Button type="submit" className="w-full" disabled={resetMutation.isPending} data-testid="button-submit">
                  {resetMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Resetting...
                    </>
                  ) : (
                    'Reset password'
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
