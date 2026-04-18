import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { InMemoryChatRepository } from './chat.repository';
import { TavilyResearchSearchAdapter } from './research-search.adapter';

@Module({
  controllers: [ChatController],
  providers: [ChatService, InMemoryChatRepository, TavilyResearchSearchAdapter],
})
export class ChatModule {}
