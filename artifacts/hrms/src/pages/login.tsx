import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Building2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLogin } from '@workspace/api-client-react';
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
      {/* Left Panel — Branding */}
      <div
        className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary via-primary/90 to-accent p-12 flex-col justify-between"
        aria-hidden="true"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white">
            <Building2 className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-semibold text-white font-sans">Enterprise HRMS</h1>
        </div>

        <div className="space-y-6">
          <h2 className="text-4xl font-bold text-white leading-tight">
            Manage Your Workforce with Confidence
          </h2>
          <p className="text-lg text-white/90 leading-relaxed max-w-md">
            Access your organisation's HR platform. Track employees, manage leave, monitor
            performance, and make data-driven decisions.
          </p>
        </div>

        <div className="text-sm text-white/70">
          &copy; {new Date().getFullYear()} Enterprise HRMS. All rights reserved.
        </div>
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
              <Building2 className="h-7 w-7 text-primary-foreground" />
            </div>
            <span className="text-xl font-semibold text-foreground font-sans">Enterprise HRMS</span>
          </div>

          <div className="space-y-6">
            <div className="space-y-2 text-center lg:text-left">
              <h1 className="text-3xl font-bold text-foreground">Welcome back</h1>
              <p className="text-muted-foreground">Enter your credentials to access your account</p>
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
                <Input
                  id="password"
                  type="password"
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
