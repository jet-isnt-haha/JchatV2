import { Injectable } from '@nestjs/common';
import type { Chat, ChatBranch, ChatMessage } from '@jchat/shared';

@Injectable()
export class InMemoryChatRepository {
  private chats = new Map<string, Chat>();
  private branches = new Map<string, ChatBranch>();
  private messages = new Map<string, ChatMessage>();
  private chatBranchIndex = new Map<string, Set<string>>();

  // ----- Chat -----

  saveChat(chat: Chat): void {
    this.chats.set(chat.id, { ...chat });
  }

  getChat(chatId: string): Chat | null {
    return this.chats.get(chatId) ?? null;
  }

  updateChat(chatId: string, updates: Partial<Chat>): Chat | null {
    const chat = this.chats.get(chatId);
    if (!chat) return null;
    const updated = { ...chat, ...updates };
    this.chats.set(chatId, updated);
    return updated;
  }

  // ----- Branch -----

  saveBranch(branch: ChatBranch): void {
    this.branches.set(branch.id, { ...branch });
    let index = this.chatBranchIndex.get(branch.chatId);
    if (!index) {
      index = new Set();
      this.chatBranchIndex.set(branch.chatId, index);
    }
    index.add(branch.id);
  }

  getBranch(branchId: string): ChatBranch | null {
    return this.branches.get(branchId) ?? null;
  }

  getBranchesByChatId(chatId: string): ChatBranch[] {
    const ids = this.chatBranchIndex.get(chatId);
    if (!ids) return [];
    return [...ids].map((id) => this.branches.get(id)!);
  }

  updateBranch(
    branchId: string,
    updates: Partial<ChatBranch>,
  ): ChatBranch | null {
    const branch = this.branches.get(branchId);
    if (!branch) return null;
    const updated = { ...branch, ...updates };
    this.branches.set(branchId, updated);
    return updated;
  }

  // ----- Message -----

  saveMessage(message: ChatMessage): void {
    this.messages.set(message.id, { ...message });
  }

  getMessage(messageId: string): ChatMessage | null {
    return this.messages.get(messageId) ?? null;
  }

  updateMessage(
    messageId: string,
    updates: Partial<ChatMessage>,
  ): ChatMessage | null {
    const msg = this.messages.get(messageId);
    if (!msg) return null;
    const updated = { ...msg, ...updates };
    this.messages.set(messageId, updated);
    return updated;
  }

  // ----- Chain Reconstruction -----

  getAncestorChain(messageId: string): ChatMessage[] {
    const chain: ChatMessage[] = [];
    let currentId: string | null = messageId;
    const MAX_DEPTH = 1000;

    while (currentId && chain.length < MAX_DEPTH) {
      const msg = this.messages.get(currentId);
      if (!msg) break;
      chain.push(msg);
      currentId = msg.parentId;
    }

    return chain.reverse();
  }
}
