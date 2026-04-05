import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PanelProps {
  children: ReactNode;
  className?: string;
}

export function Panel({ children, className }: PanelProps) {
  return (
    <section className={cn("rounded-md border bg-card", className)}>
      {children}
    </section>
  );
}
