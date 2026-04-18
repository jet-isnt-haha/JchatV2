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

  private llm: ChatOpenAI;
  private streamSessions = new Map<string, StreamSession>();

  // P0 research runtime state is kept in-memory (single-instance scope).
  private researchTasks = new Map<string, ResearchTaskState>();
  private researchStreamSessions = new Map<string, ResearchStreamSession>();

  constructor(
    private configService: ConfigService,
    private repository: InMemoryChatRepository,
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

    // 获取消息链用于上下文构建和流式输出，包含用户消息和模型消息
    const chain = this.repository.getAncestorChain(userMessage.id);

    const sessionId = randomUUID();
    const nowTs = Date.now();
    this.streamSessions.set(sessionId, {
      streamId: sessionId,
      messageId: assistantMessage.id,
      messages: chain,
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
  // ===== Deep Research (Skeleton) =====

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

    // P0 uses deterministic placeholder decomposition before real agent planner is wired.
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
      maxRounds: 5,
      currentRound: 0,
      maxDurationMs: 10 * 60 * 1000,
      elapsedMs: 0,
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

    // Emit first event so UI can render the plan confirmation step immediately.
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
      maxConcurrentBranches: 3,
      defaultAllSelected: true,
    };
  }

  confirmResearchPlan(
    chatId: string,
    taskId: string,
    selectedPlanItemIds: string[],
  ): ConfirmResearchPlanResponse {
    const state = this.getResearchTaskOrThrow(chatId, taskId);
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

    // Selected plan items become branch runtime entries; first one starts as active.
    const selectedItems = state.plan.filter((item) => item.selected);
    state.branches = selectedItems.map((item, index) => ({
      id: randomUUID(),
      planItemId: item.id,
      title: item.title,
      status: index === 0 ? "retrieving" : "pending",
      queueIndex: index,
      isActive: index === 0,
    }));

    state.activeSubQuestionTitle = state.branches[0]?.title;
    state.budget = {
      ...state.budget,
      currentRound: 1,
      elapsedMs: 0,
      etaMs: state.budget.maxDurationMs,
    };

    state.task = {
      ...state.task,
      status: "running",
      startedAt: Date.now(),
    };

    const streamSession = this.getResearchStreamSessionOrThrow(
      state.streamSessionId,
    );

    // Send initial lifecycle and progress events for right-panel streaming UI.
    this.appendResearchEvent(streamSession, {
      eventType: "plan_confirmed",
      payload: { task: state.task },
      done: false,
    });

    this.appendResearchEvent(streamSession, {
      eventType: "task_started",
      payload: {
        task: state.task,
        budget: state.budget,
      },
      done: false,
    });

    for (const branch of state.branches.slice(0, 3)) {
      this.appendResearchEvent(streamSession, {
        eventType: "branch_status_changed",
        payload: { branch },
        done: false,
      });
    }

    this.appendResearchEvent(streamSession, {
      eventType: "budget_progress",
      payload: { budget: state.budget },
      done: false,
    });

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
    // Replay buffered events first, then wait for live events.
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
    // Sequence is assigned only on server side to keep replay ordering canonical.
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
        // Stream payloads are temporary; eviction follows the same TTL window as chat SSE.
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
