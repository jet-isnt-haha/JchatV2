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
  StartResearchTaskRequest,
  StartResearchTaskResponse,
  ResearchPlanResponse,
  ConfirmResearchPlanRequest,
  ConfirmResearchPlanResponse,
  ResearchSnapshotResponse,
  ResearchResultResponse,
  ResearchStreamEvent,
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
    const safeCursor = this.parseCursorSeq(cursorSeq);
    return this.buildStreamObservable(sessionId, safeCursor);
  }

  // ===== Deep Research API =====

  @Post("chats/:chatId/research/tasks")
  startResearchTask(
    @Param("chatId") chatId: string,
    @Body() body: StartResearchTaskRequest,
  ): StartResearchTaskResponse {
    return this.chatService.startResearchTask(chatId, body.topic);
  }

  @Get("chats/:chatId/research/tasks/:taskId/plan")
  getResearchPlan(
    @Param("chatId") chatId: string,
    @Param("taskId") taskId: string,
  ): ResearchPlanResponse {
    return this.chatService.getResearchPlan(chatId, taskId);
  }

  @Post("chats/:chatId/research/tasks/:taskId/plan/confirm")
  confirmResearchPlan(
    @Param("chatId") chatId: string,
    @Param("taskId") taskId: string,
    @Body() body: ConfirmResearchPlanRequest,
  ): ConfirmResearchPlanResponse {
    return this.chatService.confirmResearchPlan(
      chatId,
      taskId,
      body.selectedPlanItemIds,
    );
  }

  @Get("chats/:chatId/research/tasks/:taskId/snapshot")
  getResearchSnapshot(
    @Param("chatId") chatId: string,
    @Param("taskId") taskId: string,
  ): ResearchSnapshotResponse {
    return this.chatService.getResearchSnapshot(chatId, taskId);
  }

  @Get("chats/:chatId/research/tasks/:taskId/result")
  getResearchResult(
    @Param("chatId") chatId: string,
    @Param("taskId") taskId: string,
  ): ResearchResultResponse {
    return this.chatService.getResearchResult(chatId, taskId);
  }

  @Sse("chats/:chatId/research/stream/:sessionId")
  streamResearch(
    @Param("sessionId") sessionId: string,
    @Query("cursorSeq") cursorSeq?: string,
  ): Observable<MessageEvent> {
    const safeCursor = this.parseCursorSeq(cursorSeq);
    return this.buildResearchStreamObservable(sessionId, safeCursor);
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

  private buildResearchStreamObservable(
    sessionId: string,
    cursorSeq: number,
  ): Observable<MessageEvent> {
    // Reuse the same SSE replay model as chat stream: client reconnects with cursorSeq.
    return new Observable((subscriber) => {
      (async () => {
        try {
          for await (const event of this.chatService.streamResearchFromSession(
            sessionId,
            cursorSeq,
          )) {
            subscriber.next({ data: event as ResearchStreamEvent });
          }
          subscriber.complete();
        } catch (err) {
          subscriber.error(err);
        }
      })();
    });
  }

  private parseCursorSeq(cursorSeq?: string): number {
    // Any invalid/negative cursor is normalized to 0 for safe replay behavior.
    const parsedCursor = Number.parseInt(cursorSeq ?? "0", 10);
    return Number.isNaN(parsedCursor) ? 0 : Math.max(parsedCursor, 0);
  }
}
