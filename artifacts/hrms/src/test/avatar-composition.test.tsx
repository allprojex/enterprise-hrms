/**
 * Styling contract for the shared circular Avatar.
 *
 * The employee profile photo was reported as "cropped too tightly — top of the
 * head cut off". The destructive crop was server-side (api-server
 * lib/imageProcessing.ts used to square-crop at upload), but the shared avatar
 * had a second, latent defect that became live the moment stored avatars stopped
 * being square: AvatarImage set no `object-fit` at all, so the <img> fell back
 * to the CSS default `fill`, which STRETCHES a portrait into the square box.
 *
 * These tests pin both halves of the rendering contract: cover (never distort)
 * and top-anchored (never cut the head off), on the shared component so every
 * surface — employee detail, employee lists, HR views, app shell — behaves the
 * same way.
 *
 * Radix only mounts Avatar.Image once the browser reports the image as loaded,
 * which jsdom never does, so the primitive is mocked to a plain <img> that
 * forwards className. That is precisely the part this change owns.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@radix-ui/react-avatar', () => ({
  Root: ({ className, children, ...props }: React.ComponentProps<'span'>) => (
    <span data-testid="avatar-root" className={className} {...props}>
      {children}
    </span>
  ),
  Image: ({ className, ...props }: React.ComponentProps<'img'>) => (
    // eslint-disable-next-line jsx-a11y/alt-text
    <img data-testid="avatar-image" className={className} {...props} />
  ),
  Fallback: ({ className, children, ...props }: React.ComponentProps<'span'>) => (
    <span data-testid="avatar-fallback" className={className} {...props}>
      {children}
    </span>
  ),
}));

import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

describe('Avatar composition', () => {
  it('renders the photograph with object-cover so a portrait is never stretched', () => {
    render(
      <Avatar>
        <AvatarImage src="/photo.jpg" alt="" />
      </Avatar>,
    );
    // Without this the <img> defaults to object-fit: fill and distorts.
    expect(screen.getByTestId('avatar-image').className).toContain('object-cover');
  });

  it('anchors the crop to the top of the frame so the head is never cut off', () => {
    render(
      <Avatar>
        <AvatarImage src="/photo.jpg" alt="" />
      </Avatar>,
    );
    // A circle must crop a portrait to a square; centring that square on the
    // middle of the frame removes the top of the head.
    expect(screen.getByTestId('avatar-image').className).toContain('object-top');
  });

  it('fills its container without imposing its own size, so context sizing still governs', () => {
    render(
      <Avatar className="h-24 w-24">
        <AvatarImage src="/photo.jpg" alt="" />
      </Avatar>,
    );
    const img = screen.getByTestId('avatar-image');
    expect(img.className).toContain('h-full');
    expect(img.className).toContain('w-full');
    // The size lives on the root, so a 32px list row and a 96px profile header
    // share one image contract and differ only in the container.
    expect(screen.getByTestId('avatar-root').className).toContain('h-24');
    expect(screen.getByTestId('avatar-root').className).toContain('w-24');
  });

  it('keeps the circular mask and clips overflow at every size', () => {
    render(
      <Avatar className="h-8 w-8">
        <AvatarImage src="/photo.jpg" alt="" />
      </Avatar>,
    );
    const root = screen.getByTestId('avatar-root');
    expect(root.className).toContain('rounded-full');
    expect(root.className).toContain('overflow-hidden');
    // shrink-0 stops a flex row from squashing the circle into an ellipse on
    // narrow (mobile) viewports.
    expect(root.className).toContain('shrink-0');
  });

  it('lets a call site override the framing without editing the shared component', () => {
    render(
      <Avatar>
        <AvatarImage src="/photo.jpg" alt="" className="object-center" />
      </Avatar>,
    );
    // tailwind-merge resolves the conflict in favour of the caller.
    const cls = screen.getByTestId('avatar-image').className;
    expect(cls).toContain('object-center');
    expect(cls).not.toContain('object-top');
  });

  it('still renders initials when there is no photograph', () => {
    render(
      <Avatar>
        <AvatarFallback>GD</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByTestId('avatar-fallback')).toHaveTextContent('GD');
    expect(screen.getByTestId('avatar-fallback').className).toContain('rounded-full');
  });
});
