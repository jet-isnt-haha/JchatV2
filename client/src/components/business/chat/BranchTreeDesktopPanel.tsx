import { BranchTreePanel } from "@/components/BranchTreePanel";
import type { BranchTreeNode } from "@jchat/shared";

interface BranchTreeDesktopPanelProps {
  tree: BranchTreeNode[];
  currentBranchId?: string;
  disabled: boolean;
  onSelect: (branchId: string) => void;
}

export function BranchTreeDesktopPanel({
  tree,
  currentBranchId,
  disabled,
  onSelect,
}: BranchTreeDesktopPanelProps) {
  return (
    <aside className="hidden min-w-0 border-r md:flex md:flex-col">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">分支树</h2>
        <p className="mt-1 text-xs text-muted-foreground">点击节点切换分支</p>
      </div>
      <div className="min-h-0 flex-1">
        <BranchTreePanel
          tree={tree}
          currentBranchId={currentBranchId}
          disabled={disabled}
          onSelect={onSelect}
        />
      </div>
    </aside>
  );
}
