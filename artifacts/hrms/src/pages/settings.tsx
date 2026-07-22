import { Settings as SettingsIcon, Wrench } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export default function Settings() {
  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground">System configuration and preferences</p>
      </div>

      {/* Coming Soon State */}
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-20 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted mb-6">
            <Wrench className="h-10 w-10 text-muted-foreground" />
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-3">System Settings</h2>
          <p className="text-muted-foreground max-w-md mb-6 leading-relaxed">
            Settings and configuration options are currently under development. This section will allow you to manage system preferences, user permissions, and organizational settings.
          </p>
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
            <SettingsIcon className="h-4 w-4" />
            Coming Soon
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
