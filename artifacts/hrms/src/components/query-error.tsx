/**
 * Reusable error state for failed React Query fetches.
 * Shows a human-readable message and an optional retry button.
 *
 * Kept as the API the pages already import; it now renders the foundation's
 * ErrorState so every failed load looks and announces the same way.
 */

import { ErrorState } from "@/components/foundation/error-state";

interface QueryErrorProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function QueryError({
  title = "Failed to load",
  message = "An error occurred while loading this data. Please try again.",
  onRetry,
}: QueryErrorProps) {
  return <ErrorState title={title} message={message} onRetry={onRetry} />;
}
