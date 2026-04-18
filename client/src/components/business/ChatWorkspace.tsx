import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@/hooks/useChat";
import { DomainError } from "@/errors/domainError";
import { DOMAIN_ERROR_MESSAGES } from "@/errors/messages";
import { useErrorActions } from "@/providers/error/ErrorProvider";
import { ChatInput } from "@/components/ChatInput";
import { StatusHint } from "@/components/base/StatusHint";
import { BranchTreeDesktopPanel } from "@/components/business/chat/BranchTreeDesktopPanel";
import { ChatWorkspaceHeader } from "@/components/business/chat/ChatWorkspaceHeader";
import { ChatTimeline } from "@/components/business/chat/ChatTimeline";
import { MobileBranchTreeDrawer } from "@/components/business/chat/MobileBranchTreeDrawer";
import { ResearchPanel } from "@/components/business/chat/ResearchPanel";

export function ChatWorkspace() {
  const {
    chat,
    branches,
    branchTree,
    messages,
    isLoading,
    isBusy,
    deepResearchEnabled,
    setDeepResearchEnabled,
    researchTask,
    researchPlan,
    selectedResearchPlanItemIds,
    toggleResearchPlanItem,
    confirmResearchPlan,
    researchBranches,
    researchEvidence,
    researchEvidenceOverflowCount,
    researchBudget,
    researchResult,
    researchErrorMessage,
    clearResearchError,
    researchFailedOrSkippedAttempts,
    researchActiveSubQuestionTitle,
    isResearchAwaitingConfirm,
    isResearchRunning,
    sendMessage,
    forkBranch,
    switchBranch,
  } = useChat();

  const { showError } = useErrorActions();
  const [treeOpen, setTreeOpen] = useState(false);
  const [switchHint, setSwitchHint] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const forkPointSet = useMemo(() => {
    const set = new Set<string>();
    for (const branch of branches) {
      if (branch.baseMessageId) {
        set.add(branch.baseMessageId);
      }
    }
    return set;
  }, [branches]);

  const handleSwitchBranch = async (branchId: string) => {
    if (isBusy) {
      const err = new DomainError(
        DOMAIN_ERROR_MESSAGES.STREAMING_IN_PROGRESS,
        "STREAMING_IN_PROGRESS",
      );
      showError(err);
      setSwitchHint(DOMAIN_ERROR_MESSAGES.STREAMING_IN_PROGRESS);
      return;
    }

    setSwitchHint("");
    try {
      await switchBranch(branchId);
      setTreeOpen(false);
    } catch (err) {
      showError(err);
      setSwitchHint("分支切换失败，请重试");
    }
  };

  return (
    <div className="mx-auto flex h-screen max-w-400 border-x md:grid md:grid-cols-[260px_minmax(0,1fr)_360px]">
      <BranchTreeDesktopPanel
        tree={branchTree}
        currentBranchId={chat?.currentBranchId}
        disabled={isBusy}
        onSelect={handleSwitchBranch}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden md:w-full">
        <ChatWorkspaceHeader
          chatCurrentBranchId={chat?.currentBranchId}
          branches={branches}
          onOpenTree={() => setTreeOpen(true)}
          onSwitchBranch={handleSwitchBranch}
        />

        {switchHint ? <StatusHint message={switchHint} /> : null}

        <ChatTimeline
          scrollRef={scrollRef}
          messages={messages}
          isLoading={isBusy}
          forkPointSet={forkPointSet}
          onForkBranch={forkBranch}
        />

        <ChatInput
          onSend={sendMessage}
          isLoading={isLoading}
          isInputLocked={isBusy}
          deepResearchEnabled={deepResearchEnabled}
          onDeepResearchToggle={(enabled) => {
            clearResearchError();
            setDeepResearchEnabled(enabled);
          }}
        />
      </div>

      <ResearchPanel
        deepResearchEnabled={deepResearchEnabled}
        task={researchTask}
        plan={researchPlan}
        selectedPlanItemIds={selectedResearchPlanItemIds}
        branches={researchBranches}
        evidence={researchEvidence}
        evidenceOverflowCount={researchEvidenceOverflowCount}
        budget={researchBudget}
        result={researchResult}
        errorMessage={researchErrorMessage}
        failedOrSkippedAttempts={researchFailedOrSkippedAttempts}
        activeSubQuestionTitle={researchActiveSubQuestionTitle}
        isAwaitingConfirm={isResearchAwaitingConfirm}
        isRunning={isResearchRunning}
        onTogglePlanItem={toggleResearchPlanItem}
        onConfirmPlan={confirmResearchPlan}
      />

      <MobileBranchTreeDrawer
        open={treeOpen}
        tree={branchTree}
        currentBranchId={chat?.currentBranchId}
        disabled={isBusy}
        onClose={() => setTreeOpen(false)}
        onSelect={handleSwitchBranch}
      />
    </div>
  );
}
