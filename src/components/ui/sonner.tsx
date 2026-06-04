"use client";

import {
    CircleCheckIcon,
    InfoIcon,
    Loader2Icon,
    OctagonXIcon,
    TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
    const { theme = "system" } = useTheme();

    return (
        <Sonner
            theme={theme as ToasterProps["theme"]}
            className="toaster group"
            icons={{
                success: <CircleCheckIcon className="size-4" />,
                info: <InfoIcon className="size-4" />,
                warning: <TriangleAlertIcon className="size-4" />,
                error: <OctagonXIcon className="size-4" />,
                loading: <Loader2Icon className="size-4 animate-spin" />,
            }}
            style={
                {
                    "--normal-bg": "var(--card)",
                    "--normal-text": "var(--card-foreground)",
                    "--normal-border": "var(--border)",
                    "--border-radius": "0.75rem",
                } as React.CSSProperties
            }
            toastOptions={{
                className:
                    "backdrop-blur-sm shadow-lg dark:shadow-[0_0_0_1px_var(--border),0_8px_24px_oklch(0_0_0_/_0.6)]",
            }}
            {...props}
        />
    );
};

export { Toaster };
