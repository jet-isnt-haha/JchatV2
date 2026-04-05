import { GitBranch, ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import type { ChatBranch } from "@jchat/shared";
import { cn } from "@/lib/utils";

interface BranchSelectorProps {
  branches: ChatBranch[];
  currentBranchId: string;
  onSwitch: (branchId: string) => void;
}

export function BranchSelector({
  branches,
  currentBranchId,
  onSwitch,
}: BranchSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentBranch = branches.find((b) => b.id === currentBranchId);
  if (branches.length <= 1) {
    return (
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <GitBranch className="size-3.5" />
        <span>{currentBranch?.name || "main"}</span>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs
                   hover:bg-muted transition-colors"
      >
        <GitBranch className="size-3.5" />
        <span>{currentBranch?.name || currentBranchId.slice(0, 8)}</span>
        <ChevronDown
          className={cn("size-3 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1 min-w-[160px]
                      rounded-md border bg-popover p-1 shadow-md"
        >
          {branches.map((branch) => (
            <button
              key={branch.id}
              onClick={() => {
                onSwitch(branch.id);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs",
                "hover:bg-muted transition-colors",
                branch.id === currentBranchId && "bg-muted font-medium",
              )}
            >
              <GitBranch className="size-3" />
              <span className="truncate">
                {branch.name || branch.id.slice(0, 8)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
