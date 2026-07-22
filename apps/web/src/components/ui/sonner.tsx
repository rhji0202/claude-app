"use client";

import { useThemeStore } from "@/stores/theme-store";
import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  const theme = useThemeStore((s) => s.theme);
  return (
    <Sonner
      theme={theme}
      position="top-right"
      toastOptions={{
        classNames: {
          toast:
            "group rounded-md border border-border bg-popover text-popover-foreground shadow-md",
          description: "text-muted-foreground",
          actionButton: "bg-accent text-accent-foreground",
          cancelButton: "bg-muted text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}
