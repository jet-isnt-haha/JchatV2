import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import type {
  Chat,
  ChatBranch,
  ChatMessage,
  BranchTreeResponse,
  BranchTreeNode,
} from "@jchat/shared";
import { randomUUID } from "crypto";
import { InMemoryChatRepository } from "./chat.repository";

interface StreamSession {
  messageId: string;
  messages: ChatMessage[];
}

@Injectable()
export class ChatService {
  private llm: ChatOpenAI;
  private streamSessions = new Map<string, StreamSession>();

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
    this.streamSessions.set(sessionId, {
      messageId: assistantMessage.id,
      messages: chain,
    });

    return { userMessage, assistantMessage, streamSessionId: sessionId };
  }

  // ===== Streaming =====

  async *streamFromSession(sessionId: string): AsyncGenerator<string> {
    const session = this.streamSessions.get(sessionId);
    if (!session) throw new NotFoundException(`Stream session not found`);

    this.streamSessions.delete(sessionId);

    const langchainMessages = session.messages.map((msg) =>
      msg.role === "user"
        ? new HumanMessage(msg.content)
        : new AIMessage(msg.content),
    );

    let fullContent = "";
    const stream = await this.llm.stream(langchainMessages);

    for await (const chunk of stream) {
      if (typeof chunk.content === "string" && chunk.content) {
        fullContent += chunk.content;
        yield chunk.content;
      }
    }

    if (session.messageId) {
      this.repository.updateMessage(session.messageId, {
        content: fullContent,
      });
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
      messageId: "",
      messages: converted,
    });

    return sessionId;
  }
}
