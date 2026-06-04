"use client";

import * as SliderPrimitive from "@radix-ui/react-slider";
import * as React from "react";

import { cn } from "@/lib/utils";

function Slider({
    className,
    defaultValue,
    value,
    min = 0,
    max = 100,
    ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
    const _values = React.useMemo(
        () =>
            Array.isArray(value)
                ? value
                : Array.isArray(defaultValue)
                  ? defaultValue
                  : [min, max],
        [value, defaultValue, min, max],
    );

    return (
        <SliderPrimitive.Root
            data-slot="slider"
            defaultValue={defaultValue}
            value={value}
            min={min}
            max={max}
            className={cn(
                "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-40 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
                className,
            )}
            {...props}
        >
            <SliderPrimitive.Track
                data-slot="slider-track"
                className="bg-muted dark:bg-muted/40 relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1"
            >
                <SliderPrimitive.Range
                    data-slot="slider-range"
                    className="bg-primary absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
                />
            </SliderPrimitive.Track>
            {Array.from({ length: _values.length }, (_, index) => (
                <SliderPrimitive.Thumb
                    data-slot="slider-thumb"
                    key={`${_values[index]}-${index}`}
                    className="block size-3.5 shrink-0 rounded-full border-2 border-primary bg-background shadow-sm ring-ring/25 transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-40"
                />
            ))}
        </SliderPrimitive.Root>
    );
}

export { Slider };
