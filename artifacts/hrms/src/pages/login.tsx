import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Building2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/foundation';
import { Label } from '@/components/ui/label';
import { useLogin, useGetTenantContext, getGetTenantContextQueryKey } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { storeToken } from '@/lib/auth';

export default function Login() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const loginMutation = useLogin();

  // Safe, unauthenticated tenant context for the hostname the browser is
  // actually on (e.g. wwm.localhost) — org name/logo only, never anything
  // sensitive. Falls back to generic platform branding for an unmapped
  // hostname (the platform's own base domain, or a hostname with no
  // assigned tenant yet) — this can never fail to render a login form.
  const { data: tenantContext } = useGetTenantContext({ query: { queryKey: getGetTenantContextQueryKey() } });
  const tenantName = tenantContext?.resolved ? tenantContext.organizationName : null;
  const systemDisplayName = tenantContext?.resolved ? tenantContext.systemDisplayName : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    loginMutation.mutate(
      { data: { email: email.trim(), password } },
      {
        onSuccess: (data) => {
          // Persist the Bearer token so subsequent API calls are authenticated.
          storeToken(data.token);
          queryClient.invalidateQueries();
          toast({
            title: 'Welcome back',
            description: 'You have been logged in successfully.',
          });
          setLocation('/dashboard');
        },
        onError: (error) => {
          toast({
            title: 'Login failed',
            description:
              'status' in error && error.status === 401
                ? 'Invalid email or password.'
                : 'An unexpected error occurred. Please try again.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  return (
    <div className="min-h-screen w-full flex">
      {/* Left Panel — Branding. Solid primary (navy for an organization that
          configures one via its branding theme; the platform's own default
          blue otherwise) rather than a gradient wash into accent — accent
          is reserved for the thin wave divider below, matching "gold for
          small accents only". */}
      <div
        className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-primary p-12 flex-col justify-between"
        aria-hidden="true"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white">
            {tenantContext?.resolved && tenantContext.logoUrl ? (
              <img
                src={tenantContext.logoUrl}
                alt=""
                className="h-8 w-8 object-contain"
                data-testid="img-tenant-logo"
              />
            ) : (
              <Building2 className="h-7 w-7 text-primary" />
            )}
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white font-sans" data-testid="text-tenant-name">
              {tenantName ?? 'Enterprise HRMS'}
            </h1>
            {systemDisplayName && (
              <p className="text-sm text-white/80 font-sans" data-testid="text-system-display-name">
                {systemDisplayName}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <h2 className="text-4xl font-bold text-white leading-tight">
            {tenantName ? `Welcome back to ${tenantName}` : 'Manage Your Workforce with Confidence'}
          </h2>
          <p className="text-lg text-white/90 leading-relaxed max-w-md">
            Access your organisation's HR platform. Track employees, manage leave, monitor
            performance, and make data-driven decisions.
          </p>
        </div>

        <div className="text-sm text-white/70">
          &copy; {new Date().getFullYear()} {tenantName ?? 'Enterprise HRMS'}. All rights reserved.
        </div>

        {/* Subtle accent wave divider — the one deliberately sparing use of
            "accent" on this panel, per the approved design direction. */}
        <svg
          className="absolute bottom-0 left-0 w-full h-16 text-accent/70"
          viewBox="0 0 400 40"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M0 28 C 100 8, 300 8, 400 28 L 400 40 L 0 40 Z" fill="currentColor" opacity="0.15" />
          <path d="M0 28 C 100 8, 300 8, 400 28" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>

      {/* Right Panel — Login Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="lg:hidden flex items-center justify-center gap-3 mb-8">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary"
              aria-hidden="true"
            >
              {tenantContext?.resolved && tenantContext.logoUrl ? (
                <img src={tenantContext.logoUrl} alt="" className="h-8 w-8 object-contain" />
              ) : (
                <Building2 className="h-7 w-7 text-primary-foreground" />
              )}
            </div>
            <div>
              <span className="block text-xl font-semibold text-foreground font-sans">
                {tenantName ?? 'Enterprise HRMS'}
              </span>
              {systemDisplayName && (
                <span className="block text-xs text-muted-foreground font-sans">{systemDisplayName}</span>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="space-y-2 text-center lg:text-left">
              <h1 className="text-3xl font-bold text-foreground">Welcome back</h1>
              <p className="text-muted-foreground">
                {tenantName
                  ? `Sign in to ${tenantName}'s HR workspace`
                  : 'Enter your credentials to access your account'}
              </p>
            </div>

            <form
              onSubmit={handleSubmit}
              className="space-y-4"
              data-testid="form-login"
              aria-label="Sign in form"
              noValidate
            >
              <div className="space-y-2">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your.name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  disabled={loginMutation.isPending}
                  data-testid="input-email"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link
                    href="/forgot-password"
                    className="text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                    data-testid="link-forgot-password"
                  >
                    Forgot password?
                  </Link>
                </div>
                <PasswordInput
                  id="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  minLength={6}
                  disabled={loginMutation.isPending}
                  data-testid="input-password"
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={loginMutation.isPending}
                data-testid="button-submit"
              >
                {loginMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    Signing in…
                  </>
                ) : (
                  'Sign in'
                )}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
