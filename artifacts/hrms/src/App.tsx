import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { AppShell } from '@/components/layout/app-shell';
import Landing from '@/pages/landing';
import Login from '@/pages/login';
import ForgotPassword from '@/pages/forgot-password';
import Dashboard from '@/pages/dashboard';
import Profile from '@/pages/profile';
import Notifications from '@/pages/notifications';
import Organizations from '@/pages/organizations';
import Settings from '@/pages/settings';
import Unauthorized from '@/pages/unauthorized';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function SecureRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <AppShell>
      <Component />
    </AppShell>
  );
}

function Router() {
  return (
    <Switch>
      {/* Public routes */}
      <Route path="/" component={Landing} />
      <Route path="/login" component={Login} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/unauthorized" component={Unauthorized} />
      
      {/* Secure routes */}
      <Route path="/dashboard">
        {() => <SecureRoute component={Dashboard} />}
      </Route>
      <Route path="/profile">
        {() => <SecureRoute component={Profile} />}
      </Route>
      <Route path="/notifications">
        {() => <SecureRoute component={Notifications} />}
      </Route>
      <Route path="/organizations">
        {() => <SecureRoute component={Organizations} />}
      </Route>
      <Route path="/settings">
        {() => <SecureRoute component={Settings} />}
      </Route>
      
      {/* 404 fallback */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
