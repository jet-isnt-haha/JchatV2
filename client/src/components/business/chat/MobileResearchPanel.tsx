import { AlertTriangle, Loader2 } from "lucide-react";
import type {
  DeepResearchTask,
  ResearchBudgetProgress,
  ResearchPlanItem,
  ResearchResult,
} from "@jchat/shared";
import { Button } from "@/components/ui/button";

interface MobileResearchPanelProps {
  deepResearchEnabled: boolean;
  task: DeepResearchTask | null;
  plan: ResearchPlanItem[];
  selectedPlanItemIds: string[];
  budget: ResearchBudgetProgress | null;
  result: ResearchResult | null;
  errorMessage: string;
  isAwaitingConfirm: boolean;
  isRunning: boolean;
  onTogglePlanItem: (planItemId: string) => void;
  onConfirmPlan: () => Promise<void>;
}

function formatDuration(ms?: number) {
  if (!ms || ms <= 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function MobileResearchPanel({
  deepResearchEnabled,
  task,
  plan,
  selectedPlanItemIds,
  budget,
  result,
  errorMessage,
  isAwaitingConfirm,
  isRunning,
  onTogglePlanItem,
  onConfirmPlan,
}: MobileResearchPanelProps) {
  if (!deepResearchEnabled && !task && !errorMessage) {
    return null;
  }

  return (
    <div className="border-t px-4 py-3 md:hidden">
      <details open={isAwaitingConfirm || isRunning}>
        <summary className="cursor-pointer text-sm font-medium">深度研究面板</summary>

        <div className="mt-2 space-y-2 text-xs">
          {task ? <p className="text-muted-foreground">课题：{task.topic}</p> : null}

          {budget ? (
            <div className="rounded border bg-muted/40 p-2 text-muted-foreground">
              <p>
                轮次：{budget.currentRound}/{budget.maxRounds}
              </p>
              <p>已用时：{formatDuration(budget.elapsedMs)}</p>
              <p>预计剩余：{formatDuration(budget.etaMs)}</p>
            </div>
          ) : null}

          {errorMessage ? (
            <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-destructive">
              <div className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 size-3.5" />
                <span>{errorMessage}</span>
              </div>
            </div>
          ) : null}

          {isAwaitingConfirm ? (
            <div className="rounded border p-2">
              <p className="font-medium">请确认子问题</p>
              <div className="mt-2 space-y-1.5">
                {plan.map((item) => {
                  const checked = selectedPlanItemIds.includes(item.id);
                  return (
                    <label key={item.id} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onTogglePlanItem(item.id)}
                        className="mt-0.5"
                      />
                      <span>{item.title}</span>
                    </label>
                  );
                })}
              </div>
              <Button
                size="sm"
                className="mt-2 w-full"
                disabled={selectedPlanItemIds.length === 0}
                onClick={() => {
                  void onConfirmPlan();
                }}
              >
                确认并开始研究
              </Button>
            </div>
          ) : null}

          {isRunning ? (
            <div className="flex items-center gap-2 rounded border bg-muted/40 p-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              <span>研究进行中，右侧面板可查看更完整证据流（桌面端）。</span>
            </div>
          ) : null}

          {result ? (
            <div className="rounded border p-2 text-muted-foreground">
              <p>输入 Tokens：{result.estimatedInputTokens}</p>
              <p>输出 Tokens：{result.estimatedOutputTokens}</p>
              <p>估算成本：${result.estimatedCostUsd.toFixed(6)}</p>
            </div>
          ) : null}
        </div>
      </details>
    </div>
  );
}
