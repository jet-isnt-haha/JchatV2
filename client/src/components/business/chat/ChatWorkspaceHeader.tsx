import { GitBranch, MessageSquare } from "lucide-react";
import type { ChatBranch } from "@jchat/shared";
import { BranchSelector } from "@/components/BranchSelector";
import { ThemeToggle } from "@/components/business/ThemeToggle";

interface ChatWorkspaceHeaderProps {
  chatCurrentBranchId?: string;
  branches: ChatBranch[];
  onOpenTree: () => void;
  onSwitchBranch: (branchId: string) => void;
}

export function ChatWorkspaceHeader({
  chatCurrentBranchId,
  branches,
  onOpenTree,
  onSwitchBranch,
}: ChatWorkspaceHeaderProps) {
  return (
    <header className="flex items-center justify-between border-b px-4 py-3">
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenTree}
          className="rounded-md border p-1.5 text-muted-foreground hover:bg-muted md:hidden"
          title="打开分支树"
        >
          <GitBranch className="size-4" />
        </button>
        <MessageSquare className="size-5" />
        <h1 className="text-lg font-semibold">JChat</h1>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        {chatCurrentBranchId ? (
          <BranchSelector
            branches={branches}
            currentBranchId={chatCurrentBranchId}
            onSwitch={onSwitchBranch}
          />
        ) : null}
      </div>
    </header>
  );
}
