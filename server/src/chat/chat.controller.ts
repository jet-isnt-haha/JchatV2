import { Body, Controller, MessageEvent, Param, Post, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { ChatService } from './chat.service';
import type { ChatRequest, ChatStartResponse } from '@jchat/shared';

@Controller('api/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * 第一步：客户端 POST 消息列表，服务端缓存并返回一个 chatId
   */
  @Post()
  startChat(@Body() body: ChatRequest): ChatStartResponse {
    const chatId = this.chatService.createSession(body.messages);
    return { chatId };
  }

  /**
   * 第二步：客户端用 chatId 建立 SSE 连接，NestJS 原生处理流式输出
   * @Sse 自动设置 Content-Type: text/event-stream 并持续推送 Observable 发出的事件
   */
  @Sse(':chatId/stream')
  streamChat(@Param('chatId') chatId: string): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      (async () => {
        try {
          for await (const content of this.chatService.streamFromSession(chatId)) {
            subscriber.next({ data: { content, done: false } });
          }
          subscriber.next({ data: { content: '', done: true } });
          subscriber.complete();
        } catch (err) {
          subscriber.error(err);
        }
      })();
    });
  }
}
