"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { MetalButton } from "@/components/metal-button";

export function BackButton() {
    const { push } = useRouter();

    return (
        <MetalButton onClick={() => push("/dashboard")} size="icon">
            <ArrowLeft className="size-4" />
        </MetalButton>
    );
}
