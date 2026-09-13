'use client';

import * as React from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cn } from '@/lib/utils';

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(
      'relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full',
      className,
    )}
    {...props}
  />
));
Avatar.displayName = AvatarPrimitive.Root.displayName;

/**
 * `object-cover` is required, not cosmetic: without an explicit object-fit an
 * <img> defaults to `fill`, which STRETCHES a non-square photograph into the
 * square avatar box. Stored avatars keep their own aspect ratio
 * (api-server lib/imageProcessing.ts `processAvatarImage`, fit: "inside"), so
 * `fill` would visibly distort every portrait.
 *
 * `object-top` frames the crop from the top of the photograph rather than its
 * vertical centre. A circular avatar necessarily crops a portrait to a square,
 * and centring that square on the middle of the frame cuts the top of the head
 * off — the head sits in the upper part of a normal head-and-shoulders
 * portrait, not the middle. Anchoring to the top keeps the whole head (hair
 * included) and lets the shoulders be what falls outside the circle instead.
 *
 * This is a general rule for portrait composition, not a per-photograph offset,
 * and it is a no-op for an already-square image (no overflow to position). Any
 * call site needing different framing can pass its own `object-*` class —
 * tailwind-merge lets the later class win.
 */
const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn('aspect-square h-full w-full object-cover object-top', className)}
    {...props}
  />
));
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      'flex h-full w-full items-center justify-center rounded-full bg-muted',
      className,
    )}
    {...props}
  />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

export { Avatar, AvatarImage, AvatarFallback };
