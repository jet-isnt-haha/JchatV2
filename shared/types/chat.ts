// ===== Core Entities =====

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;

  parentId: string | null;
  branchId: string;
  chatId: string;
  createdAt: number;
}

export interface ChatBranch {
  id: string;
  chatId: string;
  baseMessageId: string | null;
  leafMessageId: string | null;
  name?: string;
  createdAt: number;
}

export interface Chat {
  id: string;
  title?: string;
  currentBranchId: string;
  createdAt: number;
}

export interface BranchTreeNode {
  id: string;
  chatId: string;
  name?: string;
  baseMessageId: string | null;
  parentBranchId: string | null;
  createdAt: number;
  isCurrent: boolean;
  children: BranchTreeNode[];
}

export interface BranchTreeResponse {
  chatId: string;
  currentBranchId: string;
  nodes: BranchTreeNode[];
}

// ===== New Branch API =====

export interface CreateChatResponse {
  chat: Chat;
  branch: ChatBranch;
}

export interface ChatDetailResponse {
  chat: Chat;
  branches: ChatBranch[];
}

export interface CreateBranchRequest {
  baseMessageId: string;
  name?: string;
}

export interface CreateBranchResponse {
  branch: ChatBranch;
  chat: Chat;
}

export interface SwitchBranchRequest {
  currentBranchId: string;
}

export interface SwitchBranchResponse {
  chat: Chat;
}

export interface BranchMessagesResponse {
  messages: ChatMessage[];
}

export interface SendMessageRequest {
  branchId: string;
  content: string;
}

export interface SendMessageResponse {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  streamSessionId: string;
}

export interface ChatStreamChunk {
  streamId: string;
  seq: number;
  content: string;
  done: boolean;
  errorCode?: string;
}

// ===== Legacy Compatibility =====

export interface LegacyChatRequest {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface LegacyChatStartResponse {
  chatId: string;
}

// ===== Deep Research =====

export type ConfidenceLevel = "high" | "medium" | "low";

export type DeepResearchTaskStatus =
  | "planning"
  | "waiting_confirm"
  | "running"
  | "finalizing"
  | "completed"
  | "failed";

export type ResearchBranchStatus =
  | "pending"
  | "retrieving"
  | "reading"
  | "synthesizing"
  | "completed";

export interface DeepResearchTask {
  id: string;
  chatId: string;
  topic: string;
  status: DeepResearchTaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface ResearchPlanItem {
  id: string;
  title: string;
  selected: boolean;
  reason?: string;
}

export interface ResearchBranchProgress {
  id: string;
  planItemId: string;
  title: string;
  status: ResearchBranchStatus;
  queueIndex?: number;
  isActive: boolean;
}

export interface ResearchEvidenceItem {
  id: string;
  planItemId: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  accepted: boolean;
  rejectReason?: string;
  isWhitelistSource: boolean;
  createdAt: number;
}

export interface ResearchBudgetProgress {
  maxRounds: number;
  currentRound: number;
  maxDurationMs: number;
  elapsedMs: number;
  etaMs?: number;
  extensionRoundUsed: boolean;
}

export interface ResearchConfidenceItem {
  claim: string;
  confidence: ConfidenceLevel;
}

export interface ResearchFootnoteItem {
  index: number;
  title: string;
  url: string;
  snippet: string;
  isWhitelistSource: boolean;
}

export interface UnfinishedResearchItem {
  planItemId: string;
  title: string;
  reason: string;
}

export interface ResearchResult {
  reportMarkdown: string;
  footnotes: ResearchFootnoteItem[];
  confidenceSummary: ResearchConfidenceItem[];
  unfinishedItems: UnfinishedResearchItem[];
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
}

export interface StartResearchTaskRequest {
  topic: string;
}

export interface StartResearchTaskResponse {
  task: DeepResearchTask;
  streamSessionId: string;
}

export interface ResearchPlanResponse {
  taskId: string;
  items: ResearchPlanItem[];
  maxConcurrentBranches: number;
  defaultAllSelected: boolean;
}

export interface ConfirmResearchPlanRequest {
  selectedPlanItemIds: string[];
}

export interface ConfirmResearchPlanResponse {
  task: DeepResearchTask;
}

export interface ResearchSnapshotResponse {
  task: DeepResearchTask;
  branches: ResearchBranchProgress[];
  evidence: ResearchEvidenceItem[];
  budget: ResearchBudgetProgress;
  activeSubQuestionTitle?: string;
  failedOrSkippedAttempts: number;
}

export interface ResearchResultResponse {
  taskId: string;
  result: ResearchResult;
}

export type ResearchStreamEventType =
  | "plan_ready"
  | "plan_confirmed"
  | "task_started"
  | "branch_status_changed"
  | "evidence_added"
  | "evidence_rejected"
  | "budget_progress"
  | "eta_updated"
  | "conflict_detected"
  | "report_ready"
  | "task_failed";

export interface ResearchStreamEvent {
  streamId: string;
  seq: number;
  eventType: ResearchStreamEventType;
  payload?: {
    task?: DeepResearchTask;
    branch?: ResearchBranchProgress;
    evidence?: ResearchEvidenceItem;
    budget?: ResearchBudgetProgress;
    result?: ResearchResult;
    message?: string;
  };
  done: boolean;
  errorCode?: string;
}
