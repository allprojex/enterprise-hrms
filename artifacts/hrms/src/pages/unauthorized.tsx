import { Link } from 'wouter';
import { ShieldX, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function Unauthorized() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10 mb-6">
            <ShieldX className="h-10 w-10 text-destructive" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-3">403</h1>
          <h2 className="text-xl font-semibold text-foreground mb-3">Access Denied</h2>
          <p className="text-muted-foreground max-w-sm mb-8 leading-relaxed">
            You don't have permission to access this resource. If you believe this is an error, please contact your system administrator.
          </p>
          <Link href="/dashboard">
            <Button className="gap-2" data-testid="button-back-dashboard">
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
