import * as React from 'react';
import { Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { organizationInitials } from '@/lib/organization-initials';

/**
 * OrganizationLogo (WS-25 foundation).
 *
 * The one way an organization's logo is rendered anywhere in the product —
 * branding settings, the sign-in page, the navigation, Super Admin lists,
 * organization detail and invitations. It guarantees:
 *
 *   - the image is never stretched or cropped (`object-fit: contain` inside a
 *     fixed box, so square, wide and tall logos and transparent PNGs all fit);
 *   - the browser's broken-image glyph never appears: a missing URL, a 404, a
 *     removed binary or any other load failure falls back to the
 *     organization's initials (or a neutral building mark when no name is
 *     known) on the same footprint;
 *   - a new `logoUrl` is always retried — the failure state is keyed to the
 *     URL that failed, so replacing the logo clears a stale failure at once;
 *   - accessible naming: the image carries `"{name} logo"` unless it is
 *     decorative next to the visible name, in which case it is hidden from
 *     assistive technology and the fallback is too.
 *
 * Colour: the fallback (initials or mark) inherits `currentColor`, so a parent
 * on a dark plate passes e.g. `className="text-primary-foreground"`.
 *
 * `data-logo-state` reports `image` / `initials` / `placeholder` so tests and
 * styling can read which branch rendered without inspecting the DOM.
 */
export type OrganizationLogoSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'wide';

const SIZE_CLASS: Record<OrganizationLogoSize, string> = {
  xs: 'size-4 text-[10px]',
  sm: 'size-9 text-label',
  md: 'size-12 text-body font-semibold',
  lg: 'size-20 text-section',
  xl: 'size-32 text-display',
  /** Banner plate for previews: fits a horizontal wordmark comfortably. */
  wide: 'h-24 w-full max-w-60 text-section',
};

const ICON_CLASS: Record<OrganizationLogoSize, string> = {
  xs: 'size-3',
  sm: 'size-4',
  md: 'size-6',
  lg: 'size-8',
  xl: 'size-12',
  wide: 'size-8',
};

export interface OrganizationLogoProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  logoUrl: string | null | undefined;
  /** Organization display name — used for the alt text and the initials fallback. */
  name?: string | null;
  size?: OrganizationLogoSize;
  /**
   * `plain` renders only the fitted image on a transparent footprint (for a
   * parent that already supplies its own plate). `plate` adds the standard
   * bordered surface with inner padding.
   */
  variant?: 'plain' | 'plate';
  /** The visible name sits beside the logo, so the logo adds nothing for AT. */
  decorative?: boolean;
  /** `data-testid` for the `<img>` when the image branch renders. */
  imgTestId?: string;
  imgClassName?: string;
}

export function OrganizationLogo({
  logoUrl,
  name,
  size = 'md',
  variant = 'plain',
  decorative = false,
  imgTestId,
  imgClassName,
  className,
  ...props
}: OrganizationLogoProps) {
  // Keyed to the URL that failed: a different URL (a freshly uploaded logo
  // has a new random filename) is always attempted again.
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const src = logoUrl && logoUrl.trim().length > 0 ? logoUrl : null;
  const showImage = src !== null && failedSrc !== src;
  const initials = organizationInitials(name);
  const accessibleName = name ? `${name} logo` : 'Organization logo';
  const useInitials = !showImage && initials.length > 0 && size !== 'xs';
  const state = showImage ? 'image' : useInitials ? 'initials' : 'placeholder';

  return (
    <span
      data-logo-state={state}
      role={!showImage && !decorative ? 'img' : undefined}
      aria-label={!showImage && !decorative ? accessibleName : undefined}
      aria-hidden={decorative && !showImage ? true : undefined}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden align-middle text-foreground-muted',
        variant === 'plate' && 'rounded-lg border border-border bg-surface p-2',
        variant === 'plate' && !showImage && 'bg-surface-muted',
        SIZE_CLASS[size],
        className,
      )}
      {...props}
    >
      {showImage ? (
        <img
          src={src}
          alt={decorative ? '' : accessibleName}
          className={cn('max-h-full max-w-full object-contain', imgClassName)}
          draggable={false}
          onError={() => setFailedSrc(src)}
          data-testid={imgTestId}
        />
      ) : useInitials ? (
        <span aria-hidden="true" className="font-semibold tracking-wide">
          {initials}
        </span>
      ) : (
        <Building2 aria-hidden="true" className={ICON_CLASS[size]} />
      )}
    </span>
  );
}
