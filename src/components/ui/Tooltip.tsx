'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';

// Hover/focus tooltip. The trigger must be focusable (Radix asChild). Self-contained provider so it
// works in isolation (tests, portals) as well as under the app-wide provider.
export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={4}
            className="z-50 max-w-64 rounded-md bg-text-primary px-3 py-2 text-body-sm text-bg-primary"
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-text-primary" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
