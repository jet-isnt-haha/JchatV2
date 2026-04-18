import { useEffect, useRef } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  XCircle,
} from "lucide-react";
import type {
  DeepResearchTask,
  ResearchBranchProgress,
  ResearchBudgetProgress,
  ResearchEvidenceItem,
  ResearchPlanItem,
  ResearchResult,
} from "@jchat/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ResearchPanelProps {
  deepResearchEnabled: boolean;
  task: DeepResearchTask | null;
  plan: ResearchPlanItem[];
  selectedPlanItemIds: string[];
  branches: ResearchBranchProgress[];
  evidence: ResearchEvidenceItem[];
  evidenceOverflowCount: number;
  budget: ResearchBudgetProgress | null;
  result: ResearchResult | null;
  errorMessage: string;
  failedOrSkippedAttempts: number;
  activeSubQuestionTitle?: string;
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

function getStatusText(task: DeepResearchTask | null) {
  if (!task) return "未开始";
  if (task.status === "waiting_confirm") return "等待确认";
  if (task.status === "running") return "检索中";
  if (task.status === "finalizing") return "生成报告中";
  if (task.status === "completed") return "已完成";
  if (task.status === "failed") return "已失败";
  return "未知";
}

function getBranchStatusText(status: ResearchBranchProgress["status"]) {
  if (status === "pending") return "待执行";
  if (status === "retrieving") return "检索中";
  if (status === "reading") return "阅读中";
  if (status === "synthesizing") return "综合中";
  return "完成";
}

function getBranchStatusClass(status: ResearchBranchProgress["status"]) {
  if (status === "completed") return "text-emerald-500";
  if (status === "synthesizing") return "text-blue-500";
  if (status === "reading") return "text-amber-500";
  if (status === "retrieving") return "text-sky-500";
  return "text-muted-foreground";
}

export function ResearchPanel({
  deepResearchEnabled,
  task,
  plan,
  selectedPlanItemIds,
  branches,
  evidence,
  evidenceOverflowCount,
  budget,
  result,
  errorMessage,
  failedOrSkippedAttempts,
  activeSubQuestionTitle,
  isAwaitingConfirm,
  isRunning,
  onTogglePlanItem,
  onConfirmPlan,
}: ResearchPanelProps) {
  const evidenceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = evidenceRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [evidence]);

  return (
    <aside className="hidden min-w-0 border-l md:flex md:flex-col">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">深度研究</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          模式：{deepResearchEnabled ? "已开启" : "已关闭"}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="rounded-md border bg-card p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">任务状态</span>
            <span className="text-xs font-medium">{getStatusText(task)}</span>
          </div>

          {task ? (
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              <p>课题：{task.topic}</p>
              {activeSubQuestionTitle ? (
                <p>当前子问题：{activeSubQuestionTitle}</p>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">发送研究主题后开始。</p>
          )}

          {budget ? (
            <div className="mt-3 rounded border bg-muted/40 p-2 text-xs">
              <p>
                轮次：{budget.currentRound}/{budget.maxRounds}
              </p>
              <p>已用时：{formatDuration(budget.elapsedMs)}</p>
              <p>预计剩余：{formatDuration(budget.etaMs)}</p>
              <p>最长时长：{formatDuration(budget.maxDurationMs)}</p>
            </div>
          ) : null}

          {failedOrSkippedAttempts > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              失败/跳过尝试次数：{failedOrSkippedAttempts}
            </p>
          ) : null}
        </div>

        {errorMessage ? (
          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 text-destructive" />
              <div>
                <p className="font-medium text-destructive">研究失败</p>
                <p className="mt-1 text-destructive/90">{errorMessage}</p>
              </div>
            </div>
          </div>
        ) : null}

        {isAwaitingConfirm ? (
          <div className="mt-3 rounded-md border bg-card p-3">
            <p className="text-xs font-medium">拆分计划确认</p>
            <div className="mt-2 space-y-2">
              {plan.map((item) => {
                const checked = selectedPlanItemIds.includes(item.id);
                return (
                  <label key={item.id} className="flex cursor-pointer items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onTogglePlanItem(item.id)}
                      className="mt-0.5"
                    />
                    <span className="leading-relaxed">{item.title}</span>
                  </label>
                );
              })}
            </div>
            <Button
              className="mt-3 w-full"
              size="sm"
              onClick={() => {
                void onConfirmPlan();
              }}
              disabled={selectedPlanItemIds.length === 0}
            >
              确认并开始研究
            </Button>
          </div>
        ) : null}

        {branches.length > 0 ? (
          <div className="mt-3 rounded-md border bg-card p-3">
            <p className="text-xs font-medium">分支进度</p>
            <div className="mt-2 space-y-1">
              {branches.map((branch) => (
                <div key={branch.id} className="flex items-center justify-between text-xs">
                  <span className="truncate pr-2">{branch.title}</span>
                  <span className={cn("shrink-0", getBranchStatusClass(branch.status))}>
                    {getBranchStatusText(branch.status)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {!errorMessage ? (
          <div className="mt-3 rounded-md border bg-card p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">证据流</p>
              {isRunning ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
            </div>

            {evidenceOverflowCount > 0 ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                已折叠历史记录 {evidenceOverflowCount} 条
              </p>
            ) : null}

            <div ref={evidenceRef} className="mt-2 max-h-64 space-y-2 overflow-y-auto">
              {evidence.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无证据流记录</p>
              ) : (
                evidence.map((item) => (
                  <div key={item.id} className="rounded border bg-muted/30 p-2 text-[11px]">
                    <div className="flex items-center gap-1">
                      {item.accepted ? (
                        <CheckCircle2 className="size-3 text-emerald-500" />
                      ) : (
                        <XCircle className="size-3 text-rose-500" />
                      )}
                      <span className="truncate font-medium">{item.title}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-muted-foreground">{item.snippet}</p>
                    <div className="mt-1 flex items-center justify-between text-muted-foreground">
                      <span className="truncate pr-2">{item.domain}</span>
                      <span>{item.accepted ? "采纳" : item.rejectReason ?? "未采纳"}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}

        {result ? (
          <div className="mt-3 rounded-md border bg-card p-3 text-xs">
            <p className="font-medium">成本估算</p>
            <div className="mt-2 space-y-1 text-muted-foreground">
              <p>输入 Tokens：{result.estimatedInputTokens}</p>
              <p>输出 Tokens：{result.estimatedOutputTokens}</p>
              <p>估算成本：${result.estimatedCostUsd.toFixed(6)}</p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-t px-4 py-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1">
          <Clock3 className="size-3" />
          <span>SSE 实时更新 + 游标续传</span>
        </div>
      </div>
    </aside>
  );
}
