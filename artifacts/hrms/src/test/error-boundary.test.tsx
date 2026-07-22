/**
 * Tests for the ErrorBoundary component.
 * Verifies that render errors are caught and a recoverable fallback is shown.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '@/components/error-boundary';

// Suppress console.error noise from intentional render errors in tests.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Test explosion');
  return <p>All good</p>;
}

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('renders the fallback UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('resets and re-renders children when "Try again" is clicked', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );

    // Fallback is visible.
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // The underlying cause of the error is fixed first (e.g. a retry
    // succeeded upstream), updating what the boundary would render *if*
    // its error state were cleared. The boundary itself doesn't know this
    // yet — it re-renders its still-caught fallback until reset.
    rerender(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Now reset the boundary. It re-renders `children`, which are the
    // already-fixed, non-throwing ones from the rerender above.
    const tryAgain = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(tryAgain);

    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('accepts a custom fallback renderer', () => {
    render(
      <ErrorBoundary fallback={(err) => <p>Custom: {err.message}</p>}>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Custom: Test explosion')).toBeInTheDocument();
  });
});
