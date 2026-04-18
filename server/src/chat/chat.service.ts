import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import type {
  Chat,
  ChatBranch,
  ChatMessage,
  ChatStreamChunk,
  BranchTreeResponse,
  BranchTreeNode,
  ConfidenceLevel,
  DeepResearchTask,
  ResearchPlanItem,
  ResearchBranchProgress,
  ResearchEvidenceItem,
  ResearchBudgetProgress,
  ResearchResult,
  StartResearchTaskResponse,
  ResearchPlanResponse,
  ConfirmResearchPlanResponse,
  ResearchSnapshotResponse,
  ResearchResultResponse,
  ResearchStreamEvent,
} from "@jchat/shared";
import { randomUUID } from "crypto";
import { InMemoryChatRepository } from "./chat.repository";
import {
  TavilyResearchSearchAdapter,
  type ResearchSearchResult,
} from "./research-search.adapter";

type StreamStatus = "pending" | "streaming" | "completed" | "failed";

interface StreamSession {
  streamId: string;
  messageId: string;
  messages: ChatMessage[];
  status: StreamStatus;
  seq: number;
  fullContent: string;
  chunks: ChatStreamChunk[];
  listeners: Set<(chunk: ChatStreamChunk) => void>;
  expireAt: number;
  started: boolean;
}

interface ResearchTaskState {
  task: DeepResearchTask;
  plan: ResearchPlanItem[];
  branches: ResearchBranchProgress[];
  evidence: ResearchEvidenceItem[];
  budget: ResearchBudgetProgress;
  result?: ResearchResult;
  streamSessionId: string;
  failedOrSkippedAttempts: number;
  activeSubQuestionTitle?: string;
}

interface ResearchStreamSession {
  streamId: string;
  taskId: string;
  seq: number;
  events: ResearchStreamEvent[];
  listeners: Set<(event: ResearchStreamEvent) => void>;
  expireAt: number;
  closed: boolean;
}

@Injectable()
export class ChatService {
  private static readonly STREAM_TTL_MS = 2 * 60 * 1000;
  private static readonly MAX_CHUNKS_PER_SESSION = 10000;
  private static readonly MAX_BUFFER_BYTES = 2 * 1024 * 1024;
  private static readonly RESEARCH_MAX_CONCURRENT_BRANCHES = 3;
  private static readonly RESEARCH_MAX_ROUNDS = 5;
  private static readonly RESEARCH_MAX_DURATION_MS = 10 * 60 * 1000;
  private static readonly RESEARCH_EXTENSION_ROUNDS = 1;
  private static readonly RESEARCH_TAVILY_MAX_RETRIES = 2;
  private static readonly RESEARCH_TAVILY_RETRY_DELAYS_MS = [1000, 2000];
  private static readonly RESEARCH_WHITELIST_SUFFIXES = [
    "arxiv.org",
    "nature.com",
    "science.org",
    "openai.com",
    "react.dev",
    "developer.mozilla.org",
    "docs.nestjs.com",
    "who.int",
    "worldbank.org",
    "oecd.org",
    ".gov",
    ".edu",
  ];

  private llm: ChatOpenAI;
  private streamSessions = new Map<string, StreamSession>();

  // P0 research runtime state is kept in-memory (single-instance scope).
  private researchTasks = new Map<string, ResearchTaskState>();
  private researchStreamSessions = new Map<string, ResearchStreamSession>();
  private researchContextByChat = new Map<string, string>();

  constructor(
    private configService: ConfigService,
    private repository: InMemoryChatRepository,
    private researchSearchAdapter: TavilyResearchSearchAdapter,
  ) {
    this.llm = new ChatOpenAI({
      model: this.configService.get("LLM_MODEL", "gpt-3.5-turbo"),
      apiKey: this.configService.get("OPENAI_API_KEY"),
      configuration: {
        baseURL: this.configService.get("OPENAI_BASE_URL"),
      },
      streaming: true,
    });
  }

  // ===== Chat =====

  createChat(): { chat: Chat; branch: ChatBranch } {
    const chatId = randomUUID();
    const branchId = randomUUID();
    const now = Date.now();

    const chat: Chat = {
      id: chatId,
      currentBranchId: branchId,
      createdAt: now,
    };

    const branch: ChatBranch = {
      id: branchId,
      chatId,
      baseMessageId: null,
      leafMessageId: null,
      name: "main",
      createdAt: now,
    };

    this.repository.saveChat(chat);
    this.repository.saveBranch(branch);
    return { chat, branch };
  }

  getChat(chatId: string): Chat {
    const chat = this.repository.getChat(chatId);
    if (!chat) throw new NotFoundException("Chat not found");
    return chat;
  }

  // ===== Branch =====

  getBranches(chatId: string): ChatBranch[] {
    this.getChat(chatId);
    return this.repository.getBranchesByChatId(chatId);
  }

  getBranchTree(chatId: string): BranchTreeResponse {
    const chat = this.getChat(chatId);
    const branches = this.getBranches(chatId);

    const nodesById = new Map<string, BranchTreeNode>();
    const parentById = new Map<string, string | null>();

    for (const branch of branches) {
      let parentBranchId: string | null = null;

      if (branch.baseMessageId) {
        const baseMessage = this.repository.getMessage(branch.baseMessageId);
        if (baseMessage && baseMessage.chatId === chatId) {
          parentBranchId = baseMessage.branchId;
        }
      }

      parentById.set(branch.id, parentBranchId);
      nodesById.set(branch.id, {
        id: branch.id,
        chatId: branch.chatId,
        name: branch.name,
        baseMessageId: branch.baseMessageId,
        parentBranchId,
        createdAt: branch.createdAt,
        isCurrent: branch.id === chat.currentBranchId,
        children: [],
      });
    }

    const roots: BranchTreeNode[] = [];

    for (const branch of branches) {
      const node = nodesById.get(branch.id)!;
      const parentBranchId = parentById.get(branch.id);

      if (parentBranchId) {
        const parentNode = nodesById.get(parentBranchId);
        if (parentNode) {
          parentNode.children.push(node);
          continue;
        }
      }

      roots.push(node);
    }

    const sortTree = (list: BranchTreeNode[]) => {
      list.sort((a, b) => a.createdAt - b.createdAt);
      for (const node of list) {
        if (node.children.length > 0) {
          sortTree(node.children);
        }
      }
    };

    sortTree(roots);

    return {
      chatId,
      currentBranchId: chat.currentBranchId,
      nodes: roots,
    };
  }

  createBranch(
    chatId: string,
    baseMessageId: string,
    name?: string,
  ): { branch: ChatBranch; chat: Chat } {
    this.getChat(chatId);

    const baseMsg = this.repository.getMessage(baseMessageId);
    if (!baseMsg || baseMsg.chatId !== chatId) {
      throw new NotFoundException("Base message not found in this chat");
    }

    const branchId = randomUUID();
    const now = Date.now();

    const branch: ChatBranch = {
      id: branchId,
      chatId,
      baseMessageId,
      leafMessageId: baseMessageId,
      name,
      createdAt: now,
    };

    this.repository.saveBranch(branch);

    const updatedChat = this.repository.updateChat(chatId, {
      currentBranchId: branchId,
    })!;

    return { branch, chat: updatedChat };
  }

  switchBranch(chatId: string, branchId: string): Chat {
    this.getChat(chatId);

    const branch = this.repository.getBranch(branchId);
    if (!branch || branch.chatId !== chatId) {
      throw new NotFoundException("Branch not found in this chat");
    }

    return this.repository.updateChat(chatId, {
      currentBranchId: branchId,
    })!;
  }

  // ===== Messages =====

  getChainMessages(branchId: string): ChatMessage[] {
    const branch = this.repository.getBranch(branchId);
    if (!branch) throw new NotFoundException("Branch not found");
    if (!branch.leafMessageId) return [];
    return this.repository.getAncestorChain(branch.leafMessageId);
  }

  sendMessage(
    chatId: string,
    branchId: string,
    content: string,
  ): {
    userMessage: ChatMessage;
    assistantMessage: ChatMessage;
    streamSessionId: string;
  } {
    this.getChat(chatId);

    const branch = this.repository.getBranch(branchId);
    if (!branch || branch.chatId !== chatId) {
      throw new NotFoundException("Branch not found in this chat");
    }

    const now = Date.now();

    const userMessage: ChatMessage = {
      id: randomUUID(),
      role: "user",
      content,
      parentId: branch.leafMessageId,
      branchId,
      chatId,
      createdAt: now,
    };
    this.repository.saveMessage(userMessage);

    const assistantMessage: ChatMessage = {
      id: randomUUID(),
      role: "assistant",
      content: "",
      parentId: userMessage.id,
      branchId,
      chatId,
      createdAt: now + 1,
    };
    this.repository.saveMessage(assistantMessage);

    this.repository.updateBranch(branchId, {
      leafMessageId: assistantMessage.id,
    });

    // 获取消息链用于上下文构建和流式输出，包含用户消息和模型消息。
    // 如果当前 chat 有最近一次研究报告，则将其作为附加上下文注入本轮推理。
    const chain = this.repository.getAncestorChain(userMessage.id);
    const researchContext = this.researchContextByChat.get(chatId);
    const chainWithContext = researchContext
      ? [
          {
            id: `research-context-${chatId}`,
            role: "assistant" as const,
            content: `以下是本会话的研究上下文，请优先参考：\n${researchContext}`,
            parentId: null,
            branchId,
            chatId,
            createdAt: now - 1,
          },
          ...chain,
        ]
      : chain;

    const sessionId = randomUUID();
    const nowTs = Date.now();
    this.streamSessions.set(sessionId, {
      streamId: sessionId,
      messageId: assistantMessage.id,
      messages: chainWithContext,
      status: "pending",
      seq: 0,
      fullContent: "",
      chunks: [],
      listeners: new Set(),
      expireAt: nowTs + ChatService.STREAM_TTL_MS,
      started: false,
    });

    return { userMessage, assistantMessage, streamSessionId: sessionId };
  }

  // ===== Streaming =====

  async *streamFromSession(
    sessionId: string,
    cursorSeq = 0,
  ): AsyncGenerator<ChatStreamChunk> {
    // Opportunistic cleanup: we clean old sessions when any stream request arrives.
    this.cleanupExpiredSessions();

    const session = this.streamSessions.get(sessionId);
    if (!session) {
      throw new NotFoundException("Stream session not found");
    }

    if (session.expireAt <= Date.now()) {
      this.streamSessions.delete(sessionId);
      throw new GoneException("Stream session expired");
    }

    // Extend TTL on access so short network blips within the window can recover.
    this.touchSession(session);
    this.ensureSessionStarted(session).catch(() => {
      // Errors are converted to terminal chunks by ensureSessionStarted.
    });

    // Replay missing buffered chunks first, then attach to live stream.
    let localCursor = Math.max(0, cursorSeq);
    const buffered = session.chunks.filter((chunk) => chunk.seq > localCursor);
    for (const chunk of buffered) {
      localCursor = chunk.seq;
      yield chunk;
      if (chunk.done) {
        return;
      }
    }

    if (session.status === "completed" || session.status === "failed") {
      return;
    }

    const queue: ChatStreamChunk[] = [];
    let notify: (() => void) | null = null;

    const listener = (chunk: ChatStreamChunk) => {
      // Dedupe by seq to avoid duplicated render after reconnect.
      if (chunk.seq > localCursor) {
        queue.push(chunk);
        if (notify) {
          notify();
          notify = null;
        }
      }
    };

    session.listeners.add(listener);

    try {
      while (true) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
        }

        while (queue.length > 0) {
          const chunk = queue.shift()!;
          localCursor = chunk.seq;
          yield chunk;
          if (chunk.done) {
            return;
          }
        }
      }
    } finally {
      session.listeners.delete(listener);
      if (notify) {
        notify();
      }
    }
  }
  // ===== Deep Research =====

  startResearchTask(chatId: string, topic: string): StartResearchTaskResponse {
    this.getChat(chatId);
    this.cleanupExpiredResearchSessions();

    const normalizedTopic = topic.trim();
    if (!normalizedTopic) {
      throw new BadRequestException("Topic is required");
    }

    this.assertNoRunningResearchTask(chatId);

    const now = Date.now();
    const taskId = randomUUID();
    const streamSessionId = randomUUID();

    const task: DeepResearchTask = {
      id: taskId,
      chatId,
      topic: normalizedTopic,
      status: "waiting_confirm",
      createdAt: now,
    };

    const plan: ResearchPlanItem[] = [
      {
        id: randomUUID(),
        title: `${normalizedTopic} 的核心概念与边界`,
        selected: true,
      },
      {
        id: randomUUID(),
        title: `${normalizedTopic} 的现状与关键证据`,
        selected: true,
      },
      {
        id: randomUUID(),
        title: `${normalizedTopic} 的争议与风险`,
        selected: true,
      },
    ];

    const budget: ResearchBudgetProgress = {
      maxRounds: ChatService.RESEARCH_MAX_ROUNDS,
      currentRound: 0,
      maxDurationMs: ChatService.RESEARCH_MAX_DURATION_MS,
      elapsedMs: 0,
      etaMs: ChatService.RESEARCH_MAX_DURATION_MS,
      extensionRoundUsed: false,
    };

    this.researchTasks.set(taskId, {
      task,
      plan,
      branches: [],
      evidence: [],
      budget,
      streamSessionId,
      failedOrSkippedAttempts: 0,
    });

    const streamSession: ResearchStreamSession = {
      streamId: streamSessionId,
      taskId,
      seq: 0,
      events: [],
      listeners: new Set(),
      expireAt: now + ChatService.STREAM_TTL_MS,
      closed: false,
    };
    this.researchStreamSessions.set(streamSessionId, streamSession);

    this.appendResearchEvent(streamSession, {
      eventType: "plan_ready",
      payload: { task },
      done: false,
    });

    return { task, streamSessionId };
  }

  getResearchPlan(chatId: string, taskId: string): ResearchPlanResponse {
    const state = this.getResearchTaskOrThrow(chatId, taskId);
    return {
      taskId,
      items: state.plan,
      maxConcurrentBranches: ChatService.RESEARCH_MAX_CONCURRENT_BRANCHES,
      defaultAllSelected: true,
    };
  }

  confirmResearchPlan(
    chatId: string,
    taskId: string,
    selectedPlanItemIds: string[],
  ): ConfirmResearchPlanResponse {
    const state = this.getResearchTaskOrThrow(chatId, taskId);
    if (state.task.status !== "waiting_confirm") {
      throw new BadRequestException("Research task is not waiting for confirm");
    }

    const selectedSet = new Set(selectedPlanItemIds);
    if (selectedSet.size === 0) {
      throw new BadRequestException("At least one plan item must be selected");
    }

    const validIds = new Set(state.plan.map((item) => item.id));
    for (const id of selectedSet) {
      if (!validIds.has(id)) {
        throw new BadRequestException("Selected plan item id is invalid");
      }
    }

    state.plan = state.plan.map((item) => ({
      ...item,
      selected: selectedSet.has(item.id),
    }));

    const selectedItems = state.plan.filter((item) => item.selected);
    state.branches = selectedItems.map((item, index) => ({
      id: randomUUID(),
      planItemId: item.id,
      title: item.title,
      status: "pending",
      queueIndex: index,
      isActive: false,
    }));

    state.task = {
      ...state.task,
      status: "running",
      startedAt: Date.now(),
      completedAt: undefined,
      errorCode: undefined,
      errorMessage: undefined,
    };

    state.budget.currentRound = 0;
    state.budget.elapsedMs = 0;
    state.budget.etaMs = state.budget.maxDurationMs;
    state.activeSubQuestionTitle = undefined;

    const streamSession = this.getResearchStreamSessionOrThrow(
      state.streamSessionId,
    );

    this.appendResearchEvent(streamSession, {
      eventType: "plan_confirmed",
      payload: { task: state.task },
      done: false,
    });

    this.appendResearchEvent(streamSession, {
      eventType: "task_started",
      payload: { task: state.task, budget: state.budget },
      done: false,
    });

    void this.executeResearchTask(taskId);

    return { task: state.task };
  }

  getResearchSnapshot(
    chatId: string,
    taskId: string,
  ): ResearchSnapshotResponse {
    const state = this.getResearchTaskOrThrow(chatId, taskId);
    return {
      task: state.task,
      branches: state.branches,
      evidence: state.evidence,
      budget: state.budget,
      activeSubQuestionTitle: state.activeSubQuestionTitle,
      failedOrSkippedAttempts: state.failedOrSkippedAttempts,
    };
  }

  getResearchResult(chatId: string, taskId: string): ResearchResultResponse {
    const state = this.getResearchTaskOrThrow(chatId, taskId);
    if (!state.result) {
      throw new NotFoundException("Research result not ready");
    }
    return {
      taskId,
      result: state.result,
    };
  }

  async *streamResearchFromSession(
    sessionId: string,
    cursorSeq = 0,
  ): AsyncGenerator<ResearchStreamEvent> {
    this.cleanupExpiredResearchSessions();

    const session = this.getResearchStreamSessionOrThrow(sessionId);
    this.touchResearchSession(session);

    let localCursor = Math.max(0, cursorSeq);
    const buffered = session.events.filter((event) => event.seq > localCursor);
    for (const event of buffered) {
      localCursor = event.seq;
      yield event;
      if (event.done) {
        return;
      }
    }

    if (session.closed) {
      return;
    }

    const queue: ResearchStreamEvent[] = [];
    let notify: (() => void) | null = null;

    const listener = (event: ResearchStreamEvent) => {
      if (event.seq > localCursor) {
        queue.push(event);
        if (notify) {
          notify();
          notify = null;
        }
      }
    };

    session.listeners.add(listener);

    try {
      while (true) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
        }

        while (queue.length > 0) {
          const event = queue.shift()!;
          localCursor = event.seq;
          yield event;
          if (event.done) {
            return;
          }
        }
      }
    } finally {
      session.listeners.delete(listener);
      if (notify) {
        notify();
      }
    }
  }

  private async executeResearchTask(taskId: string): Promise<void> {
    const state = this.researchTasks.get(taskId);
    if (!state || state.task.status !== "running") {
      return;
    }

    const streamSession = this.getResearchStreamSessionOrThrow(
      state.streamSessionId,
    );

    try {
      let noGainRounds = 0;
      let previousAccepted = this.countAcceptedEvidence(state);

      while (true) {
        state.budget.currentRound += 1;
        this.refreshBudget(state);

        this.appendResearchEvent(streamSession, {
          eventType: "budget_progress",
          payload: { budget: state.budget },
          done: false,
        });

        const acceptedAdded = await this.processResearchRound(state, streamSession);
        const currentAccepted = this.countAcceptedEvidence(state);

        if (acceptedAdded <= 0 || currentAccepted <= previousAccepted) {
          noGainRounds += 1;
        } else {
          noGainRounds = 0;
        }
        previousAccepted = currentAccepted;

        if (!this.hasWorkableBranch(state)) {
          break;
        }

        if (this.isResearchCoverageReached(state)) {
          break;
        }

        if (noGainRounds >= 2) {
          break;
        }

        this.refreshBudget(state);
        const roundExceeded = state.budget.currentRound >= state.budget.maxRounds;
        const timeExceeded = state.budget.elapsedMs >= state.budget.maxDurationMs;

        if (roundExceeded || timeExceeded) {
          if (!state.budget.extensionRoundUsed) {
            state.budget.extensionRoundUsed = true;
            state.budget.maxRounds += ChatService.RESEARCH_EXTENSION_ROUNDS;
            this.appendResearchEvent(streamSession, {
              eventType: "budget_progress",
              payload: { budget: state.budget },
              done: false,
            });
          } else {
            break;
          }
        }
      }

      this.finalizeResearchTaskSuccess(state, streamSession);
    } catch (error) {
      this.finalizeResearchTaskFailure(state, streamSession, error);
    }
  }

  private async processResearchRound(
    state: ResearchTaskState,
    streamSession: ResearchStreamSession,
  ): Promise<number> {
    const candidates = state.branches
      .filter((branch) => !this.hasBranchCoverage(state, branch.planItemId))
      .sort((a, b) => (a.queueIndex ?? 0) - (b.queueIndex ?? 0));

    if (candidates.length === 0) {
      state.activeSubQuestionTitle = undefined;
      this.refreshBudget(state);
      return 0;
    }

    const active = candidates.slice(0, ChatService.RESEARCH_MAX_CONCURRENT_BRANCHES);
    const activeIds = new Set(active.map((branch) => branch.id));

    for (const branch of state.branches) {
      if (!activeIds.has(branch.id) && branch.status !== "completed") {
        this.setResearchBranchStatus(state, streamSession, branch.id, "pending", false);
      }
    }

    state.activeSubQuestionTitle = active[0]?.title;

    const roundResults = await Promise.allSettled(
      active.map((branch) => this.processBranchRound(state, streamSession, branch)),
    );

    let acceptedAdded = 0;
    for (const result of roundResults) {
      if (result.status === "fulfilled") {
        acceptedAdded += result.value;
      } else {
        throw result.reason;
      }
    }

    this.refreshBudget(state);
    this.appendResearchEvent(streamSession, {
      eventType: "eta_updated",
      payload: {
        budget: state.budget,
        message: state.activeSubQuestionTitle,
      },
      done: false,
    });

    return acceptedAdded;
  }

  private async processBranchRound(
    state: ResearchTaskState,
    streamSession: ResearchStreamSession,
    branch: ResearchBranchProgress,
  ): Promise<number> {
    this.setResearchBranchStatus(state, streamSession, branch.id, "retrieving", true);

    const query = this.buildSearchQuery(state.task.topic, branch.title, state.budget.currentRound);
    const searchResults = await this.searchWithRetry(query, 6);

    this.setResearchBranchStatus(state, streamSession, branch.id, "reading", true);

    let acceptedAdded = 0;
    for (const item of searchResults) {
      const evidence = this.toEvidenceItem(state, branch, item);
      state.evidence.push(evidence);

      this.appendResearchEvent(streamSession, {
        eventType: evidence.accepted ? "evidence_added" : "evidence_rejected",
        payload: { evidence },
        done: false,
      });

      if (evidence.accepted) {
        acceptedAdded += 1;
      }
    }

    this.setResearchBranchStatus(state, streamSession, branch.id, "synthesizing", true);

    if (this.hasBranchCoverage(state, branch.planItemId)) {
      this.setResearchBranchStatus(state, streamSession, branch.id, "completed", false);
    } else {
      this.setResearchBranchStatus(state, streamSession, branch.id, "pending", false);
    }

    return acceptedAdded;
  }

  private toEvidenceItem(
    state: ResearchTaskState,
    branch: ResearchBranchProgress,
    searchResult: ResearchSearchResult,
  ): ResearchEvidenceItem {
    const domain = this.extractDomain(searchResult.url);
    const snippet = this.normalizeSnippet(searchResult.snippet);
    const isDuplicate = state.evidence.some(
      (item) => item.planItemId === branch.planItemId && item.url === searchResult.url,
    );

    let accepted = true;
    let rejectReason: string | undefined;

    if (isDuplicate) {
      accepted = false;
      rejectReason = "重复来源";
    } else if (snippet.length < 60) {
      accepted = false;
      rejectReason = "摘录信息不足";
    }

    return {
      id: randomUUID(),
      planItemId: branch.planItemId,
      title: searchResult.title,
      url: searchResult.url,
      domain,
      snippet,
      accepted,
      rejectReason,
      isWhitelistSource: this.isWhitelistDomain(domain),
      createdAt: Date.now(),
    };
  }

  private async searchWithRetry(
    query: string,
    maxResults: number,
  ): Promise<ResearchSearchResult[]> {
    let lastError: unknown;

    for (
      let attempt = 0;
      attempt <= ChatService.RESEARCH_TAVILY_MAX_RETRIES;
      attempt += 1
    ) {
      try {
        return await this.researchSearchAdapter.search(query, maxResults);
      } catch (error) {
        lastError = error;
        if (attempt >= ChatService.RESEARCH_TAVILY_MAX_RETRIES) {
          break;
        }
        const delay =
          ChatService.RESEARCH_TAVILY_RETRY_DELAYS_MS[attempt] ??
          ChatService.RESEARCH_TAVILY_RETRY_DELAYS_MS[
            ChatService.RESEARCH_TAVILY_RETRY_DELAYS_MS.length - 1
          ] ??
          1000;
        await this.delay(delay);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("TAVILY_SEARCH_FAILED");
  }

  private finalizeResearchTaskSuccess(
    state: ResearchTaskState,
    streamSession: ResearchStreamSession,
  ): void {
    state.task = {
      ...state.task,
      status: "finalizing",
    };

    for (const branch of state.branches) {
      if (branch.status !== "completed" || branch.isActive) {
        this.setResearchBranchStatus(
          state,
          streamSession,
          branch.id,
          "completed",
          false,
        );
      }
    }

    state.activeSubQuestionTitle = undefined;
    state.result = this.buildResearchResult(state);
    this.researchContextByChat.set(
      state.task.chatId,
      this.truncateSnippet(state.result.reportMarkdown, 6000),
    );
    state.task = {
      ...state.task,
      status: "completed",
      completedAt: Date.now(),
    };

    this.appendResearchEvent(streamSession, {
      eventType: "report_ready",
      payload: {
        task: state.task,
        result: state.result,
      },
      done: true,
    });
  }

  private finalizeResearchTaskFailure(
    state: ResearchTaskState,
    streamSession: ResearchStreamSession,
    error: unknown,
  ): void {
    const message =
      error instanceof Error ? error.message : "Deep research execution failed";

    state.task = {
      ...state.task,
      status: "failed",
      completedAt: Date.now(),
      errorCode: "RESEARCH_FAILED",
      errorMessage: message,
    };

    // P0 behavior: failure clears panel state and only surfaces actionable error.
    state.branches = [];
    state.evidence = [];
    state.result = undefined;
    state.activeSubQuestionTitle = undefined;

    this.appendResearchEvent(streamSession, {
      eventType: "task_failed",
      payload: {
        task: state.task,
        message:
          "深度研究失败，请检查 Tavily API Key、网络连接，或稍后重试。",
      },
      done: true,
      errorCode: "RESEARCH_FAILED",
    });
  }

  private buildResearchResult(state: ResearchTaskState): ResearchResult {
    const includedBranches = state.branches.filter((branch) =>
      this.hasBranchCoverage(state, branch.planItemId),
    );
    const unfinishedItems = state.branches
      .filter((branch) => !this.hasBranchCoverage(state, branch.planItemId))
      .map((branch) => ({
        planItemId: branch.planItemId,
        title: branch.title,
        reason: "证据不足（需至少3条证据且覆盖2个以上域名）",
      }));

    const footnotes: ResearchResult["footnotes"] = [];
    const confidenceSummary: ResearchResult["confidenceSummary"] = [];
    const report: string[] = [];

    report.push(`# 深度研究报告：${state.task.topic}`);
    report.push("");
    report.push("## 执行摘要");
    report.push(
      `本次研究共完成 ${includedBranches.length} 条研究路径，累计采纳 ${this.countAcceptedEvidence(
        state,
      )} 条证据。报告采用句子级脚注引用，并对非白名单来源自动降权。`,
    );

    for (const branch of includedBranches) {
      const acceptedEvidence = this.getAcceptedEvidenceByPlanItem(
        state,
        branch.planItemId,
      );
      const confidence = this.calculateBranchConfidence(state, branch.planItemId);
      confidenceSummary.push({
        claim: branch.title,
        confidence,
      });

      report.push("");
      report.push(`## ${branch.title}`);

      const introRefs = acceptedEvidence.slice(0, 2).map((item) =>
        this.appendFootnote(footnotes, item),
      );

      report.push(
        `该子问题的关键证据呈现一致趋势 ${introRefs
          .map((index) => this.renderFootnote(index))
          .join("")}。`,
      );
      report.push(`置信度：${this.renderConfidenceLabel(confidence)}。`);
      report.push("");
      report.push("关键发现：");

      acceptedEvidence.slice(0, 3).forEach((item, idx) => {
        const refs = [this.appendFootnote(footnotes, item)];
        if (idx === 0 && acceptedEvidence[1]) {
          refs.push(this.appendFootnote(footnotes, acceptedEvidence[1]));
        }
        report.push(
          `- ${this.toClaimSentence(item.snippet)} ${refs
            .map((index) => this.renderFootnote(index))
            .join("")}`,
        );
      });

      report.push("");
      report.push("不确定性：");
      report.push("- 证据来自公开网页文本，时效性与样本完整性可能影响结论稳定性。");
    }

    report.push("");
    report.push("## 争议与不确定性总览");
    const rejectedCount = state.evidence.filter((item) => !item.accepted).length;
    report.push(`- 本轮检索共拒绝 ${rejectedCount} 条证据，主要原因是重复来源或信息不足。`);
    report.push("- 对于白名单外来源，系统已自动降权并在置信度计算中体现。\n");

    report.push("## 未完成研究项");
    if (unfinishedItems.length === 0) {
      report.push("- 无");
    } else {
      for (const item of unfinishedItems) {
        report.push(`- ${item.title}：${item.reason}`);
      }
    }

    report.push("");
    report.push("## 参考来源");
    for (const footnote of footnotes) {
      report.push(`<a id="ref-${footnote.index}"></a>${footnote.index}. [${footnote.title}](${footnote.url})  `);
      report.push(
        `摘录：${this.truncateSnippet(footnote.snippet, 200)}  `,
      );
      report.push(
        `来源类型：${footnote.isWhitelistSource ? "白名单来源" : "非白名单来源（已降权）"}`,
      );
    }

    const reportMarkdown = report.join("\n");
    const estimatedInputTokens = Math.ceil(
      (state.task.topic.length +
        state.evidence.reduce((sum, item) => sum + item.snippet.length, 0)) /
        4,
    );
    const estimatedOutputTokens = Math.ceil(reportMarkdown.length / 4);
    const estimatedCostUsd = Number(
      (estimatedInputTokens * 0.000001 + estimatedOutputTokens * 0.000002).toFixed(
        6,
      ),
    );

    return {
      reportMarkdown,
      footnotes,
      confidenceSummary,
      unfinishedItems,
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedCostUsd,
    };
  }

  private renderFootnote(index: number): string {
    return `[${index}](#ref-${index})`;
  }

  private appendFootnote(
    footnotes: ResearchResult["footnotes"],
    evidence: ResearchEvidenceItem,
  ): number {
    const index = footnotes.length + 1;
    footnotes.push({
      index,
      title: evidence.title,
      url: evidence.url,
      snippet: this.truncateSnippet(evidence.snippet, 200),
      isWhitelistSource: evidence.isWhitelistSource,
    });
    return index;
  }

  private toClaimSentence(snippet: string): string {
    const normalized = this.normalizeSnippet(snippet)
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!normalized) {
      return "该来源提供了补充性证据。";
    }

    const shortened = this.truncateSnippet(normalized, 120);
    return shortened.endsWith("。") ? shortened : `${shortened}。`;
  }

  private renderConfidenceLabel(confidence: ConfidenceLevel): string {
    if (confidence === "high") return "高";
    if (confidence === "medium") return "中";
    return "低";
  }

  private calculateBranchConfidence(
    state: ResearchTaskState,
    planItemId: string,
  ): ConfidenceLevel {
    const accepted = this.getAcceptedEvidenceByPlanItem(state, planItemId);
    if (accepted.length === 0) {
      return "low";
    }

    const domainCount = new Set(accepted.map((item) => item.domain)).size;
    const whitelistCount = accepted.filter((item) => item.isWhitelistSource).length;
    const whitelistRatio = whitelistCount / accepted.length;

    let score = 0;
    if (accepted.length >= 3) score += 2;
    if (accepted.length >= 5) score += 1;
    if (domainCount >= 2) score += 2;
    if (whitelistRatio >= 0.7) score += 2;
    else if (whitelistRatio >= 0.4) score += 1;
    else score -= 1;

    if (score >= 5) return "high";
    if (score >= 3) return "medium";
    return "low";
  }

  private hasWorkableBranch(state: ResearchTaskState): boolean {
    return state.branches.some((branch) => !this.hasBranchCoverage(state, branch.planItemId));
  }

  private isResearchCoverageReached(state: ResearchTaskState): boolean {
    if (state.branches.length === 0) {
      return false;
    }
    return state.branches.every((branch) =>
      this.hasBranchCoverage(state, branch.planItemId),
    );
  }

  private hasBranchCoverage(state: ResearchTaskState, planItemId: string): boolean {
    const accepted = this.getAcceptedEvidenceByPlanItem(state, planItemId);
    if (accepted.length < 3) {
      return false;
    }
    const domainCount = new Set(accepted.map((item) => item.domain)).size;
    return domainCount >= 2;
  }

  private getAcceptedEvidenceByPlanItem(
    state: ResearchTaskState,
    planItemId: string,
  ): ResearchEvidenceItem[] {
    return state.evidence.filter(
      (item) => item.planItemId === planItemId && item.accepted,
    );
  }

  private countAcceptedEvidence(state: ResearchTaskState): number {
    return state.evidence.filter((item) => item.accepted).length;
  }

  private setResearchBranchStatus(
    state: ResearchTaskState,
    streamSession: ResearchStreamSession,
    branchId: string,
    status: ResearchBranchProgress["status"],
    isActive: boolean,
  ): void {
    const index = state.branches.findIndex((branch) => branch.id === branchId);
    if (index === -1) {
      return;
    }

    const current = state.branches[index];
    if (current.status === status && current.isActive === isActive) {
      return;
    }

    const updated: ResearchBranchProgress = {
      ...current,
      status,
      isActive,
    };
    state.branches[index] = updated;

    this.appendResearchEvent(streamSession, {
      eventType: "branch_status_changed",
      payload: { branch: updated },
      done: false,
    });
  }

  private refreshBudget(state: ResearchTaskState): void {
    const startedAt = state.task.startedAt ?? state.task.createdAt;
    const elapsed = Date.now() - startedAt;
    state.budget.elapsedMs = elapsed;

    if (state.budget.currentRound <= 0) {
      state.budget.etaMs = state.budget.maxDurationMs;
      return;
    }

    const avgRoundMs = elapsed / state.budget.currentRound;
    const remainingRounds = Math.max(0, state.budget.maxRounds - state.budget.currentRound);
    const byRound = avgRoundMs * remainingRounds;
    const byTimeCap = Math.max(0, state.budget.maxDurationMs - elapsed);

    state.budget.etaMs = Math.max(0, Math.min(byRound, byTimeCap));
  }

  private buildSearchQuery(topic: string, branchTitle: string, round: number): string {
    return `${topic} ${branchTitle} 研究证据 round ${round}`;
  }

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "unknown";
    }
  }

  private isWhitelistDomain(domain: string): boolean {
    const normalized = domain.toLowerCase();
    return ChatService.RESEARCH_WHITELIST_SUFFIXES.some((suffix) =>
      normalized === suffix || normalized.endsWith(`.${suffix}`) || normalized.endsWith(suffix),
    );
  }

  private normalizeSnippet(snippet: string): string {
    return snippet.replace(/\s+/g, " ").trim();
  }

  private truncateSnippet(snippet: string, maxLength: number): string {
    if (snippet.length <= maxLength) {
      return snippet;
    }
    return `${snippet.slice(0, maxLength)}...`;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private getResearchTaskOrThrow(
    chatId: string,
    taskId: string,
  ): ResearchTaskState {
    const state = this.researchTasks.get(taskId);
    if (!state || state.task.chatId !== chatId) {
      throw new NotFoundException("Research task not found");
    }
    return state;
  }

  private getResearchStreamSessionOrThrow(
    sessionId: string,
  ): ResearchStreamSession {
    const session = this.researchStreamSessions.get(sessionId);
    if (!session) {
      throw new NotFoundException("Research stream session not found");
    }

    if (session.expireAt <= Date.now()) {
      this.researchStreamSessions.delete(sessionId);
      throw new GoneException("Research stream session expired");
    }

    return session;
  }

  private appendResearchEvent(
    session: ResearchStreamSession,
    event: Omit<ResearchStreamEvent, "streamId" | "seq">,
  ): ResearchStreamEvent {
    session.seq += 1;
    const nextEvent: ResearchStreamEvent = {
      streamId: session.streamId,
      seq: session.seq,
      ...event,
    };

    session.events.push(nextEvent);
    if (nextEvent.done) {
      session.closed = true;
    }

    this.touchResearchSession(session);

    for (const listener of session.listeners) {
      listener(nextEvent);
    }

    return nextEvent;
  }

  private touchResearchSession(session: ResearchStreamSession): void {
    session.expireAt = Date.now() + ChatService.STREAM_TTL_MS;
  }

  private cleanupExpiredResearchSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.researchStreamSessions.entries()) {
      if (session.expireAt <= now) {
        this.researchStreamSessions.delete(id);
      }
    }
  }

  private assertNoRunningResearchTask(chatId: string): void {
    for (const state of this.researchTasks.values()) {
      if (
        state.task.chatId === chatId &&
        state.task.status !== "completed" &&
        state.task.status !== "failed"
      ) {
        throw new ConflictException("A research task is already running");
      }
    }
  }
  // ===== Legacy Compatibility =====

  createLegacySession(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
  ): string {
    const sessionId = randomUUID();

    const converted: ChatMessage[] = messages.map((msg, i) => ({
      id: randomUUID(),
      role: msg.role,
      content: msg.content,
      parentId: null,
      branchId: "",
      chatId: "",
      createdAt: Date.now() + i,
    }));

    this.streamSessions.set(sessionId, {
      streamId: sessionId,
      messageId: "",
      messages: converted,
      status: "pending",
      seq: 0,
      fullContent: "",
      chunks: [],
      listeners: new Set(),
      expireAt: Date.now() + ChatService.STREAM_TTL_MS,
      started: false,
    });

    return sessionId;
  }

  private async ensureSessionStarted(session: StreamSession): Promise<void> {
    if (session.started) {
      return;
    }

    // A stream session is started at most once; all reconnects reuse buffered/live chunks.
    session.started = true;
    session.status = "streaming";
    this.touchSession(session);

    const langchainMessages = session.messages.map((msg) =>
      msg.role === "user"
        ? new HumanMessage(msg.content)
        : new AIMessage(msg.content),
    );

    try {
      const stream = await this.llm.stream(langchainMessages);
      let stoppedByLimit = false;

      for await (const chunk of stream) {
        if (typeof chunk.content === "string" && chunk.content) {
          session.fullContent += chunk.content;
          const appended = this.appendChunk(session, {
            streamId: session.streamId,
            content: chunk.content,
            done: false,
          });
          if (!appended) {
            stoppedByLimit = true;
            break;
          }
        }
      }

      if (session.messageId) {
        this.repository.updateMessage(session.messageId, {
          content: session.fullContent,
        });
      }

      if (!stoppedByLimit) {
        session.status = "completed";
        this.appendChunk(session, {
          streamId: session.streamId,
          content: "",
          done: true,
        });
      }
    } catch {
      session.status = "failed";
      this.appendChunk(session, {
        streamId: session.streamId,
        content: "",
        done: true,
        errorCode: "STREAM_FAILED",
      });
    }
  }

  private appendChunk(
    session: StreamSession,
    chunk: Omit<ChatStreamChunk, "seq">,
  ): boolean {
    // Service assigns the canonical seq, clients only consume/dedupe by seq.
    session.seq += 1;
    const nextChunk: ChatStreamChunk = {
      ...chunk,
      seq: session.seq,
    };

    session.chunks.push(nextChunk);
    this.touchSession(session);

    if (
      session.chunks.length > ChatService.MAX_CHUNKS_PER_SESSION ||
      this.getSessionBufferBytes(session) > ChatService.MAX_BUFFER_BYTES
    ) {
      // When memory guard is hit, push a terminal error chunk so clients can stop gracefully.
      session.status = "failed";
      const limitChunk: ChatStreamChunk = {
        streamId: session.streamId,
        seq: session.seq,
        content: "",
        done: true,
        errorCode: "STREAM_BUFFER_LIMIT",
      };

      if (!nextChunk.done) {
        session.seq += 1;
        limitChunk.seq = session.seq;
        session.chunks.push(limitChunk);
      }

      for (const listener of session.listeners) {
        listener(nextChunk.done ? nextChunk : limitChunk);
      }
      return false;
    }

    for (const listener of session.listeners) {
      listener(nextChunk);
    }

    return true;
  }

  private getSessionBufferBytes(session: StreamSession): number {
    return session.chunks.reduce(
      (sum, chunk) => sum + Buffer.byteLength(chunk.content, "utf8"),
      0,
    );
  }

  private touchSession(session: StreamSession): void {
    session.expireAt = Date.now() + ChatService.STREAM_TTL_MS;
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.streamSessions.entries()) {
      if (session.expireAt <= now) {
        this.streamSessions.delete(id);
      }
    }
  }
}
