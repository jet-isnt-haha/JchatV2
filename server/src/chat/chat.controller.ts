import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  Patch,
  Post,
  Query,
  Sse,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { ChatService } from "./chat.service";
import type {
  CreateChatResponse,
  ChatDetailResponse,
  BranchTreeResponse,
  CreateBranchRequest,
  CreateBranchResponse,
  SwitchBranchRequest,
  SwitchBranchResponse,
  BranchMessagesResponse,
  SendMessageRequest,
  SendMessageResponse,
  LegacyChatRequest,
  LegacyChatStartResponse,
  ChatStreamChunk,
} from "@jchat/shared";

@Controller("api")
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // ===== New Branch API =====

  @Post("chats")
  createChat(): CreateChatResponse {
    return this.chatService.createChat();
  }

  @Get("chats/:chatId")
  getChatDetail(@Param("chatId") chatId: string): ChatDetailResponse {
    const chat = this.chatService.getChat(chatId);
    const branches = this.chatService.getBranches(chatId);
    return { chat, branches };
  }

  @Get("chats/:chatId/branch-tree")
  getBranchTree(@Param("chatId") chatId: string): BranchTreeResponse {
    return this.chatService.getBranchTree(chatId);
  }

  @Post("chats/:chatId/branches")
  createBranch(
    @Param("chatId") chatId: string,
    @Body() body: CreateBranchRequest,
  ): CreateBranchResponse {
    return this.chatService.createBranch(chatId, body.baseMessageId, body.name);
  }

  @Patch("chats/:chatId")
  switchBranch(
    @Param("chatId") chatId: string,
    @Body() body: SwitchBranchRequest,
  ): SwitchBranchResponse {
    const chat = this.chatService.switchBranch(chatId, body.currentBranchId);
    return { chat };
  }

  @Get("chats/:chatId/branches/:branchId/messages")
  getBranchMessages(
    @Param("branchId") branchId: string,
  ): BranchMessagesResponse {
    const messages = this.chatService.getChainMessages(branchId);
    return { messages };
  }

  @Post("chats/:chatId/messages")
  sendMessage(
    @Param("chatId") chatId: string,
    @Body() body: SendMessageRequest,
  ): SendMessageResponse {
    return this.chatService.sendMessage(chatId, body.branchId, body.content);
  }

  @Sse("chats/:chatId/stream/:sessionId")
  streamNewChat(
    @Param("sessionId") sessionId: string,
    @Query("cursorSeq") cursorSeq?: string,
  ): Observable<MessageEvent> {
    const parsedCursor = Number.parseInt(cursorSeq ?? "0", 10);
    const safeCursor = Number.isNaN(parsedCursor)
      ? 0
      : Math.max(parsedCursor, 0);
    return this.buildStreamObservable(sessionId, safeCursor);
  }

  // ===== Legacy API (backward compatible) =====

  @Post("chat")
  legacyStartChat(@Body() body: LegacyChatRequest): LegacyChatStartResponse {
    const chatId = this.chatService.createLegacySession(body.messages);
    return { chatId };
  }

  @Sse("chat/:chatId/stream")
  legacyStreamChat(@Param("chatId") chatId: string): Observable<MessageEvent> {
    return this.buildStreamObservable(chatId, 0);
  }

  // ===== Shared =====

  private buildStreamObservable(
    sessionId: string,
    cursorSeq: number,
  ): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      (async () => {
        try {
          for await (const chunk of this.chatService.streamFromSession(
            sessionId,
            cursorSeq,
          )) {
            subscriber.next({ data: chunk as ChatStreamChunk });
          }
          subscriber.complete();
        } catch (err) {
          subscriber.error(err);
        }
      })();
    });
  }
}
