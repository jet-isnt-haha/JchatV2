import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  type ReactFlowInstance,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GitBranch } from "lucide-react";
import type { BranchTreeNode } from "@jchat/shared";

interface BranchTreePanelProps {
  tree: BranchTreeNode[];
  currentBranchId?: string;
  disabled?: boolean;
  onSelect: (branchId: string) => void;
}

function flattenTree(tree: BranchTreeNode[]) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const sortedRoots = [...tree].sort((a, b) => a.createdAt - b.createdAt);
  let cursorY = 20;

  const visit = (item: BranchTreeNode, depth: number) => {
    const y = cursorY;
    cursorY += 84;

    nodes.push({
      id: item.id,
      position: { x: 24 + depth * 220, y },
      data: {
        label: item.name || item.id.slice(0, 8),
        fullName: item.name,
        isCurrent: item.isCurrent,
      },
      draggable: false,
      selectable: true,
      style: {
        borderRadius: 10,
        border: item.isCurrent
          ? "1px solid var(--color-primary)"
          : "1px solid var(--color-border)",
        background: item.isCurrent
          ? "color-mix(in oklch, var(--color-primary) 12%, white 88%)"
          : "var(--color-card)",
        color: "var(--color-foreground)",
        padding: "8px 10px",
        fontSize: 12,
        minWidth: 140,
      },
    });

    const children = [...item.children].sort(
      (a, b) => a.createdAt - b.createdAt,
    );

    for (const child of children) {
      edges.push({
        id: `${item.id}->${child.id}`,
        source: item.id,
        target: child.id,
        animated: false,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: "var(--color-muted-foreground)", strokeWidth: 1.2 },
      });
      visit(child, depth + 1);
    }
  };

  for (const root of sortedRoots) {
    visit(root, 0);
  }

  return { nodes, edges };
}

export function BranchTreePanel({
  tree,
  currentBranchId,
  disabled,
  onSelect,
}: BranchTreePanelProps) {
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(
    null,
  );

  const { nodes, edges } = useMemo(() => {
    return flattenTree(tree);
  }, [tree]);

  useEffect(() => {
    if (!flowInstance || !currentBranchId) return;

    const node = nodes.find((item) => item.id === currentBranchId);
    if (!node) return;

    flowInstance.setCenter(node.position.x + 70, node.position.y + 20, {
      zoom: 0.95,
      duration: 380,
    });
  }, [flowInstance, currentBranchId, nodes]);

  const onNodeClick: NodeMouseHandler = (_, node) => {
    if (disabled) return;
    if (node.id === currentBranchId) return;
    onSelect(node.id);
  };

  if (nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <GitBranch className="size-4" />
          <span>发送第一条消息后会出现分支树</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onInit={setFlowInstance}
        onNodeClick={onNodeClick}
        fitView
        minZoom={0.6}
        maxZoom={1.2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={!disabled}
        panOnDrag={!disabled}
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
