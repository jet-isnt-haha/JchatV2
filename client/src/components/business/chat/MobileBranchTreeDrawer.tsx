import type { BranchTreeNode } from "@jchat/shared";
import { Drawer } from "@/components/base/Drawer";
import { BranchTreePanel } from "@/components/BranchTreePanel";

interface MobileBranchTreeDrawerProps {
  open: boolean;
  tree: BranchTreeNode[];
  currentBranchId?: string;
  disabled: boolean;
  onClose: () => void;
  onSelect: (branchId: string) => void;
}

export function MobileBranchTreeDrawer({
  open,
  tree,
  currentBranchId,
  disabled,
  onClose,
  onSelect,
}: MobileBranchTreeDrawerProps) {
  return (
    <Drawer open={open} onClose={onClose} title="分支树">
      <BranchTreePanel
        tree={tree}
        currentBranchId={currentBranchId}
        disabled={disabled}
        onSelect={onSelect}
      />
    </Drawer>
  );
}
