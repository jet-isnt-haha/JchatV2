import { cn } from "@/lib/utils";

interface StatusHintProps {
  message: string;
  className?: string;
}

export function StatusHint({ message, className }: StatusHintProps) {
  return (
    <div
      className={cn(
        "border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground",
        className,
      )}
    >
      {message}
    </div>
  );
}
