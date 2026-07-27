import { useEffect } from 'react';
import { useLocation } from 'wouter';
import {
  useGetMe,
  getGetMeQueryKey,
  useListOrganizationModules,
  getListOrganizationModulesQueryKey,
} from '@workspace/api-client-react';
import { Skeleton } from '@/components/ui/skeleton';
import { isModuleAccessible } from '@/lib/module-access';

interface ModuleGateProps {
  moduleKey: string;
  children: React.ReactNode;
}

/**
 * Frontend Module Gating (W6). Redirects to /unauthorized when moduleKey
 * isn't enabled for the caller's active organization -- UX-level only, same
 * as Admin's route guard (see admin.tsx): the real enforcement is
 * server-side (requireModuleEnabled, W5). No route in App.tsx uses this
 * yet -- every registered module (W3) is still status "hidden" with no
 * shipped page. Wrap a future module page's <Route> with this the same way
 * existing routes wrap with SecureRoute, once that module's workstream
 * ships a page.
 */
export function ModuleGate({ moduleKey, children }: ModuleGateProps) {
  const [, setLocation] = useLocation();
  const { data: user, isLoading: userLoading } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const { data: modules, isLoading: modulesLoading } = useListOrganizationModules(organizationId, {
    query: { queryKey: getListOrganizationModulesQueryKey(organizationId), enabled: !!user },
  });

  const stillChecking = userLoading || modulesLoading;
  const accessible = !stillChecking && !!modules && isModuleAccessible(modules, moduleKey);

  useEffect(() => {
    if (!stillChecking && !accessible) {
      setLocation('/unauthorized');
    }
  }, [stillChecking, accessible, setLocation]);

  if (stillChecking) {
    return (
      <div className="p-6 lg:p-8 space-y-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!accessible) {
    return null;
  }

  return <>{children}</>;
}
