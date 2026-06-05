"use client";

import { useEffect } from "react";

export function PWARegister() {
    useEffect(() => {
        if (typeof window !== "undefined" && "serviceWorker" in navigator) {
            navigator.serviceWorker.register("/sw.js").catch((err) => {
                console.error("ServiceWorker registration failed: ", err);
            });
        }
    }, []);

    return null;
}
