/**
 * Enterprise design foundation — shared components (WS-25A).
 *
 * Import from '@/components/foundation'. These sit above the shadcn
 * primitives in components/ui and below the pages: they encode the platform's
 * conventions (status vocabulary, page header, KPI tile, empty / error /
 * loading states, password and search fields) so pages compose rather than
 * re-implement them.
 */
export { StatusBadge, type StatusBadgeProps } from './status-badge';
export { toneForStatus, formatStatusLabel, type StatusTone } from '@/lib/status-tone';
export { MetricCard, type MetricCardProps } from './metric-card';
export { PageHeader, SectionHeader, type PageHeaderProps, type SectionHeaderProps } from './page-header';
export { PageContainer, type PageContainerProps } from './page-container';
export { EmptyState, NoResultsState, type EmptyStateProps, type NoResultsStateProps } from './empty-state';
export { ErrorState, type ErrorStateProps } from './error-state';
export { LoadingState, TableSkeleton, ListSkeleton, type LoadingStateProps, type TableSkeletonProps, type ListSkeletonProps } from './loading-state';
export { PasswordInput, type PasswordInputProps } from './password-input';
export { SearchInput, type SearchInputProps } from './search-input';
