"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { MetalButton } from "@/components/metal-button";

export function BackButton() {
    const router = useRouter();

    return (
        <MetalButton onClick={() => router.push("/dashboard")} size="icon">
            <ArrowLeft className="size-4" />
        </MetalButton>
    );
}
