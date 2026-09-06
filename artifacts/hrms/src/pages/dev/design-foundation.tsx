/**
 * WS-25A Design Foundation showcase — DEVELOPMENT ONLY.
 *
 * Routed at /dev/design-foundation from App.tsx inside an
 * `import.meta.env.DEV` guard, so it is compiled out of production builds and
 * never reachable on a deployed host. It renders every foundation primitive
 * in its states so the visual system can be reviewed in one place, and it is
 * mounted by src/test/design-foundation.test.tsx as the component-level
 * proof. Everything shown is static sample text — no data, no API calls.
 */
import * as React from 'react';
import { Building2, Download, Plus, Trash2, Users, Search as SearchIcon, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableActionCell, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/hooks/use-toast';
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  LoadingState,
  MetricCard,
  NoResultsState,
  PageContainer,
  PageHeader,
  PasswordInput,
  SearchInput,
  SectionHeader,
  StatusBadge,
  TableSkeleton,
} from '@/components/foundation';
import { applyTenantTheme, clearTenantTheme } from '@/lib/tenant-theme-tokens';
import { usePrefersReducedMotion } from '@/lib/motion';

const STATUSES = ['Active', 'Trial', 'Suspended', 'Pending', 'Invited', 'Revoked', 'Approved', 'Rejected', 'Expired', 'Healthy', 'Warning', 'Critical', 'Draft', 'Running'];

/** WWM's stored Production theme (navy / gold) — the reference tenant. */
const SAMPLE_TENANT_THEME = {
  primary: '220 55% 16%',
  primaryForeground: '0 0% 100%',
  accent: '38 70% 50%',
  accentForeground: '220 55% 15%',
  sidebar: '220 55% 16%',
  sidebarForeground: '210 30% 92%',
  sidebarAccent: '38 70% 50%',
  sidebarAccentForeground: '220 55% 15%',
  ring: '220 55% 16%',
};

/** A deliberately unreadable pair: the clamp must replace the foreground. */
const UNREADABLE_TENANT_THEME = {
  primary: '48 100% 50%',
  primaryForeground: '0 0% 100%',
};

function Swatch({ name, className }: { name: string; className: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`size-8 shrink-0 rounded-md border border-border ${className}`} aria-hidden="true" />
      <code className="text-helper text-foreground-muted">{name}</code>
    </div>
  );
}

export default function DesignFoundationShowcase() {
  const { toast } = useToast();
  const reduced = usePrefersReducedMotion();
  const [tenant, setTenant] = React.useState<'platform' | 'wwm' | 'unreadable'>('platform');
  const [loading, setLoading] = React.useState(false);
  const [query, setQuery] = React.useState('');

  React.useEffect(() => {
    const root = document.documentElement;
    if (tenant === 'platform') clearTenantTheme(root);
    else applyTenantTheme(root, tenant === 'wwm' ? SAMPLE_TENANT_THEME : UNREADABLE_TENANT_THEME);
    return () => clearTenantTheme(root);
  }, [tenant]);

  return (
    <PageContainer data-testid="design-foundation-showcase">
      <PageHeader
        eyebrow="WS-25A · development only"
        title="Design Foundation Showcase"
        description="Every foundation primitive in its states. Static sample content; nothing here reads or writes data."
        actions={
          <>
            <Button variant="outline" size="sm">
              <Download />
              Export
            </Button>
            <Button size="sm">
              <Plus />
              Primary action
            </Button>
          </>
        }
      />

      {/* Tenant accent behaviour */}
      <section className="space-y-4" aria-labelledby="sh-tenant">
        <SectionHeader
          as="h2"
          title={<span id="sh-tenant">Tenant branding on top of the system</span>}
          description="Brand tokens follow the tenant; status colours, text, borders and surfaces do not. An unreadable foreground is clamped."
          actions={
            <RadioGroup value={tenant} onValueChange={(v) => setTenant(v as typeof tenant)} className="flex gap-4" aria-label="Tenant theme">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="platform" id="t-platform" />
                <Label htmlFor="t-platform">Platform</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="wwm" id="t-wwm" />
                <Label htmlFor="t-wwm">WWM navy / gold</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="unreadable" id="t-unreadable" />
                <Label htmlFor="t-unreadable">Unreadable pair</Label>
              </div>
            </RadioGroup>
          }
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Swatch name="--primary" className="bg-primary" />
          <Swatch name="--primary-soft" className="bg-primary-soft" />
          <Swatch name="--accent" className="bg-accent" />
          <Swatch name="--success (never tenant-set)" className="bg-success" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button>Brand primary</Button>
          <Badge variant="brand">Brand soft</Badge>
          <Badge variant="accent">Accent soft</Badge>
          <StatusBadge status="Active" />
          <StatusBadge status="Suspended" />
        </div>
      </section>

      {/* Typography */}
      <section className="space-y-4" aria-labelledby="sh-type">
        <SectionHeader as="h2" title={<span id="sh-type">Typography</span>} description="Inter Variable, self-hosted. Nothing below 12px." />
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-display">Display 28 — Good morning, Gloria</p>
            <p className="text-title">Page title 22 — Employees</p>
            <p className="text-heading">Heading 18 — Dialog title</p>
            <p className="text-section">Section 17 — Employment details</p>
            <p className="text-card-title">Card title 15 — Leave balance</p>
            <p className="text-body">Body 14 — The quick brown fox jumps over the lazy dog. Configure once, serve every organization.</p>
            <p className="text-label">Label 13 — Email address</p>
            <p className="text-helper text-foreground-muted">Helper 12 — We will never share this address.</p>
            <p className="text-meta">Meta 12 — Updated 2 hours ago</p>
            <p className="text-overline">Overline — Administration</p>
            <p className="text-kpi">1,284</p>
            <p className="text-table">Table cell 13 — tabular <span className="tabular-nums">0123456789</span></p>
          </CardContent>
        </Card>
      </section>

      {/* Buttons */}
      <section className="space-y-4" aria-labelledby="sh-buttons">
        <SectionHeader as="h2" title={<span id="sh-buttons">Buttons</span>} description="Hover, press, focus and loading feedback from tokens. No exaggerated motion." />
        <div className="flex flex-wrap items-center gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">
            <Trash2 />
            Destructive
          </Button>
          <Button variant="link">Link</Button>
          <Button size="icon" aria-label="Settings">
            <Settings2 />
          </Button>
          <Button loading={loading} onClick={() => setLoading((v) => !v)}>
            {loading ? 'Saving…' : 'Toggle loading'}
          </Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm">Small</Button>
          <Button>Default</Button>
          <Button size="lg">Large</Button>
          <Button size="icon-sm" variant="outline" aria-label="Search">
            <SearchIcon />
          </Button>
        </div>
      </section>

      {/* Form controls */}
      <section className="space-y-4" aria-labelledby="sh-forms">
        <SectionHeader as="h2" title={<span id="sh-forms">Form controls</span>} description="One height scale, one focus ring, one error treatment." />
        <Card>
          <CardContent className="grid gap-5 pt-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="f-email" required>
                Email
              </Label>
              <Input id="f-email" type="email" placeholder="name@organization.org" aria-required="true" />
              <p className="text-helper text-foreground-muted">Used for sign-in and notifications.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="f-password">Password</Label>
              <PasswordInput id="f-password" placeholder="••••••••" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="f-invalid">Employee number</Label>
              <Input id="f-invalid" defaultValue="EMP-" aria-invalid="true" aria-describedby="f-invalid-error" />
              <p id="f-invalid-error" className="text-helper font-medium text-danger">
                Employee number must be at least 6 characters.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="f-disabled">Disabled</Label>
              <Input id="f-disabled" disabled value="Read only value" readOnly />
            </div>
            <div className="space-y-2">
              <Label htmlFor="f-select">Organization type</Label>
              <Select>
                <SelectTrigger id="f-select">
                  <SelectValue placeholder="Select a type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="business">Business</SelectItem>
                  <SelectItem value="church">Church</SelectItem>
                  <SelectItem value="ngo">NGO</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="f-search">Search</Label>
              <SearchInput id="f-search" placeholder="Search employees" value={query} onChange={(e) => setQuery(e.target.value)} onClear={() => setQuery('')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="f-date">Start date</Label>
              <Input id="f-date" type="date" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="f-file">Document</Label>
              <Input id="f-file" type="file" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="f-notes">Notes</Label>
              <Textarea id="f-notes" placeholder="Optional context for the reviewer" />
            </div>
            <div className="flex flex-wrap items-center gap-6 md:col-span-2">
              <div className="flex items-center gap-2">
                <Checkbox id="f-check" defaultChecked />
                <Label htmlFor="f-check">Checkbox</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="f-check-ind" checked="indeterminate" aria-label="Indeterminate checkbox" />
                <Label htmlFor="f-check-ind">Indeterminate</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="f-switch" defaultChecked />
                <Label htmlFor="f-switch">Switch</Label>
              </div>
              <RadioGroup defaultValue="a" className="flex gap-4" aria-label="Radio example">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="a" id="r-a" />
                  <Label htmlFor="r-a">Option A</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="b" id="r-b" />
                  <Label htmlFor="r-b">Option B</Label>
                </div>
              </RadioGroup>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Cards */}
      <section className="space-y-4" aria-labelledby="sh-cards">
        <SectionHeader as="h2" title={<span id="sh-cards">Cards and surfaces</span>} description="Flat by default. Intentional variants, subtle depth only where content floats." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Employees" value="1,284" supporting="across 6 branches" delta={{ text: '+12 this month', tone: 'success' }} icon={<Users />} />
          <MetricCard label="Active modules" value="9" icon={<Settings2 />} />
          <MetricCard label="Pending requests" value="17" delta={{ text: '3 overdue', tone: 'danger' }} />
          <MetricCard label="Loading" value="" loading />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Standard</CardTitle>
              <CardDescription>Grouping container, hairline border, no shadow.</CardDescription>
            </CardHeader>
          </Card>
          <Card variant="actionable" tabIndex={0} role="button" aria-label="Open Worldwide Word Ministries">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="size-4 text-foreground-muted" aria-hidden="true" />
                Actionable
              </CardTitle>
              <CardDescription>Hover border, focus ring, pointer.</CardDescription>
            </CardHeader>
          </Card>
          <Card variant="information">
            <CardHeader>
              <CardTitle>Information</CardTitle>
              <CardDescription className="text-info-soft-foreground/85">Guidance on a tinted surface.</CardDescription>
            </CardHeader>
          </Card>
          <Card variant="alert" tone="warning">
            <CardHeader>
              <CardTitle>Alert · warning</CardTitle>
              <CardDescription className="text-warning-soft-foreground/85">3px semantic rule, soft tint.</CardDescription>
            </CardHeader>
          </Card>
          <Card variant="summary">
            <CardHeader>
              <CardTitle>Summary</CardTitle>
              <CardDescription>Read-only summary on the muted surface.</CardDescription>
            </CardHeader>
          </Card>
          <Card variant="elevated">
            <CardHeader>
              <CardTitle>Elevated</CardTitle>
              <CardDescription>The only shadowed variant, for floating content.</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>

      {/* Badges */}
      <section className="space-y-4" aria-labelledby="sh-badges">
        <SectionHeader as="h2" title={<span id="sh-badges">Status badges</span>} description="One mapping from status to tone. Text is always the carrier." />
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
          <StatusBadge status="something_new" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Destructive</Badge>
          <Badge variant="neutral">Neutral</Badge>
        </div>
      </section>

      {/* Table */}
      <section className="space-y-4" aria-labelledby="sh-table">
        <SectionHeader as="h2" title={<span id="sh-table">Table foundation</span>} description="Muted header, 44px rows, hover and selected states, numeric alignment, action column." />
        <Card>
          <Table stickyHeader>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Status</TableHead>
                <TableHead data-align="right">Leave balance</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ['Ama Mensah', 'Finance', 'Active', '12.5'],
                ['Kofi Boateng', 'Operations', 'Pending', '4'],
                ['Efua Owusu', 'Ministry', 'Suspended', '0'],
              ].map(([name, dept, status, bal], i) => (
                <TableRow key={name} data-state={i === 1 ? 'selected' : undefined}>
                  <TableCell className="font-medium text-foreground">{name}</TableCell>
                  <TableCell className="text-foreground-muted">{dept}</TableCell>
                  <TableCell>
                    <StatusBadge status={status} />
                  </TableCell>
                  <TableCell numeric>{bal}</TableCell>
                  <TableActionCell>
                    <div>
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${name}`}>
                        <Settings2 />
                      </Button>
                    </div>
                  </TableActionCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>

      {/* Tabs, dialog, dropdown, toast */}
      <section className="space-y-4" aria-labelledby="sh-overlays">
        <SectionHeader as="h2" title={<span id="sh-overlays">Tabs, dialog, menu, toast</span>} description={`Menus 180ms in / 120ms out, dialogs 180ms, sheets 240ms. Reduced motion: ${reduced ? 'ON (animations collapsed)' : 'off'}.`} />
        <Tabs defaultValue="overview">
          <TabsList aria-label="Sections">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="audit">Audit log</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="text-body-sm text-foreground-muted">
            Line tabs with an underline indicator.
          </TabsContent>
          <TabsContent value="members">…</TabsContent>
          <TabsContent value="audit">…</TabsContent>
        </Tabs>
        <Tabs defaultValue="a">
          <TabsList variant="pill" aria-label="Density">
            <TabsTrigger value="a">Comfortable</TabsTrigger>
            <TabsTrigger value="b">Compact</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Suspend organization</DialogTitle>
                <DialogDescription>Members will lose access until the organization is reactivated.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline">Cancel</Button>
                <Button variant="destructive">Suspend</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">Open menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Open workspace</DropdownMenuItem>
              <DropdownMenuItem>Invite member</DropdownMenuItem>
              <DropdownMenuItem className="text-danger focus:text-danger">Suspend</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={() => toast({ title: 'Saved', description: 'Organization settings were updated.', variant: 'success' })}>
            Success toast
          </Button>
          <Button variant="outline" onClick={() => toast({ title: 'Login failed', description: 'An unexpected error occurred.', variant: 'destructive' })}>
            Error toast
          </Button>
        </div>
      </section>

      {/* Loading / empty / error */}
      <section className="space-y-4" aria-labelledby="sh-states">
        <SectionHeader as="h2" title={<span id="sh-states">Loading, empty and error states</span>} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="pt-6">
              <TableSkeleton columns={['Employee', 'Department', 'Status']} rows={3} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-4 pt-6">
              <LoadingState size="sm" />
              <ListSkeleton lines={2} />
              <div className="flex items-center gap-3">
                <Spinner />
                <Skeleton className="h-4 w-40" />
              </div>
            </CardContent>
          </Card>
          <EmptyState title="No employees yet" description="Add your first employee or import from a spreadsheet." action={<Button size="sm"><Plus />Add employee</Button>} />
          <NoResultsState query="gloria" onClear={() => setQuery('')} />
          <ErrorState onRetry={() => undefined} />
          <ErrorState size="sm" title="Could not load leave balances" message="The service did not respond." />
        </div>
      </section>
    </PageContainer>
  );
}
