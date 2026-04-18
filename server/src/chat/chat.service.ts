import { GoneException, Injectable, NotFoundException } from "@nestjs/common";
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
  StartResearchTaskResponse,
  ResearchPlanResponse,
  ConfirmResearchPlanResponse,
  ResearchSnapshotResponse,
  ResearchResultResponse,
  ResearchStreamEvent,
} from "@jchat/shared";
import { randomUUID } from "crypto";
import { InMemoryChatRepository } from "./chat.repository";
import { ResearchAgentService } from "./research-agent.service";

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

@Injectable()
export class ChatService {
  private static readonly STREAM_TTL_MS = 2 * 60 * 1000;
  private static readonly MAX_CHUNKS_PER_SESSION = 10000;
  private static readonly MAX_BUFFER_BYTES = 2 * 1024 * 1024;

  private llm: ChatOpenAI;
  private streamSessions = new Map<string, StreamSession>();

  constructor(
    private configService: ConfigService,
    private repository: InMemoryChatRepository,
    private researchAgent: ResearchAgentService,
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
    const researchContext = this.researchAgent.getResearchContextForChat(chatId);
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
    return this.researchAgent.startResearchTask(chatId, topic);
  }

  getResearchPlan(chatId: string, taskId: string): ResearchPlanResponse {
    return this.researchAgent.getResearchPlan(chatId, taskId);
  }

  confirmResearchPlan(
    chatId: string,
    taskId: string,
    selectedPlanItemIds: string[],
  ): ConfirmResearchPlanResponse {
    return this.researchAgent.confirmResearchPlan(
      chatId,
      taskId,
      selectedPlanItemIds,
    );
  }

  getResearchSnapshot(
    chatId: string,
    taskId: string,
  ): ResearchSnapshotResponse {
    return this.researchAgent.getResearchSnapshot(chatId, taskId);
  }

  getResearchResult(chatId: string, taskId: string): ResearchResultResponse {
    return this.researchAgent.getResearchResult(chatId, taskId);
  }

  streamResearchFromSession(
    sessionId: string,
    cursorSeq = 0,
  ): AsyncGenerator<ResearchStreamEvent> {
    return this.researchAgent.streamResearchFromSession(sessionId, cursorSeq);
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
