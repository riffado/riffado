"use client";

import * as SliderPrimitive from "@radix-ui/react-slider";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Single-thumb slider for night surfaces (the player). Played track is
 * cream, the rest dim, the thumb terracotta so it reads as the playhead.
 */
export function NightSlider({
    className,
    ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
    return (
        <SliderPrimitive.Root
            className={cn(
                "relative flex h-9 w-full touch-none items-center select-none data-[disabled]:opacity-50",
                className,
            )}
            {...props}
        >
            <SliderPrimitive.Track className="relative h-1 grow overflow-hidden rounded-full bg-night-border">
                <SliderPrimitive.Range className="absolute h-full bg-night-foreground" />
            </SliderPrimitive.Track>
            <SliderPrimitive.Thumb className="block size-3 rounded-full bg-terracotta-bright outline-none focus-visible:ring-[3px] focus-visible:ring-terracotta-bright/40" />
        </SliderPrimitive.Root>
    );
}
