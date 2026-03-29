import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import type { ChatMessage } from '@jchat/shared';
import { randomUUID } from 'crypto';

@Injectable()
export class ChatService {
  private llm: ChatOpenAI;

  // 内存 session 存储：chatId -> 消息列表
  private sessions = new Map<string, ChatMessage[]>();

  constructor(private configService: ConfigService) {
    this.llm = new ChatOpenAI({
      model: this.configService.get('LLM_MODEL', 'gpt-3.5-turbo'),
      apiKey: this.configService.get('OPENAI_API_KEY'),
      configuration: {
        baseURL: this.configService.get('OPENAI_BASE_URL'),
      },
      streaming: true,
    });
  }

  createSession(messages: ChatMessage[]): string {
    const chatId = randomUUID();
    this.sessions.set(chatId, messages);
    return chatId;
  }

  async *streamFromSession(chatId: string): AsyncGenerator<string> {
    const messages = this.sessions.get(chatId);
    if (!messages) throw new Error(`Session ${chatId} not found`);

    this.sessions.delete(chatId); // 用完即删，避免内存泄漏

    const langchainMessages = messages.map((msg) =>
      msg.role === 'user'
        ? new HumanMessage(msg.content)
        : new AIMessage(msg.content),
    );

    const stream = await this.llm.stream(langchainMessages);
    for await (const chunk of stream) {
      if (typeof chunk.content === 'string' && chunk.content) {
        yield chunk.content;
      }
    }
  }
}
