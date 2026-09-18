/**
 * UI-01A accessibility foundation.
 *
 * Guards the interaction-affordance decisions that are easy to undo by
 * accident: the small controls keep an expanded hit area, the overlay close
 * buttons stay full-size, and validation errors stay on a semantic token
 * rather than the 12px floor. Sizes are asserted through the class contract
 * (jsdom applies no stylesheet), with the stylesheet itself covered by
 * design-tokens.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';

describe('UI-01A — small controls keep a usable interactive area', () => {
  it('checkbox paints 16px but presses at the expanded target', () => {
    render(<Checkbox aria-label="Mandatory" />);
    const box = screen.getByRole('checkbox');
    expect(box.className).toContain('touch-target');
    // the visible control is unchanged
    expect(box.className).toContain('size-4');
  });

  it('radio item paints 16px but presses at the expanded target', () => {
    render(
      <RadioGroup defaultValue="a">
        <RadioGroupItem value="a" aria-label="Option A" />
      </RadioGroup>,
    );
    const radio = screen.getByRole('radio', { name: 'Option A' });
    expect(radio.className).toContain('touch-target');
    expect(radio.className).toContain('size-4');
  });

  it('switch keeps its 20x36 track and presses at the expanded target', () => {
    render(<Switch aria-label="Active" />);
    const toggle = screen.getByRole('switch');
    expect(toggle.className).toContain('touch-target');
    expect(toggle.className).toContain('h-5');
    expect(toggle.className).toContain('w-9');
  });
});

describe('UI-01A — overlay close controls are full-size targets', () => {
  it('Sheet close is a 36px target, not a bare 16px glyph', () => {
    render(
      <Sheet open>
        <SheetContent>content</SheetContent>
      </Sheet>,
    );
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close.className).toContain('size-9');
    expect(close.className).toContain('inline-flex');
    expect(close.className).toContain('items-center');
    expect(close.className).toContain('justify-center');
    // the glyph itself stays 16px
    expect(close.querySelector('svg')?.getAttribute('class')).toContain('h-4');
  });

  it('Dialog close keeps the same 36px target (the pattern Sheet now matches)', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close.className).toContain('size-9');
  });
});

describe('UI-01A — validation errors use a semantic token', () => {
  function FormHarness() {
    const form = useForm<{ email: string }>({ defaultValues: { email: '' } });
    // Seeded once, the way a resolver would after a failed submit.
    useEffect(() => {
      form.setError('email', { type: 'manual', message: 'Email address is required' });
    }, [form]);
    return (
      <Form {...form}>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input {...field} aria-label="Email" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </Form>
    );
  }

  it('renders the message on text-body-sm, never on the 12px text-helper floor', async () => {
    render(<FormHarness />);
    const message = await waitFor(() => screen.getByText('Email address is required'));
    expect(message.className).toContain('text-body-sm');
    expect(message.className).not.toContain('text-helper');
    // still visually an error
    expect(message.className).toContain('text-danger');
    // and still wired to the field for assistive technology
    expect(message.id).toBeTruthy();
  });
});
