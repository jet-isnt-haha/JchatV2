import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { InMemoryChatRepository } from './chat.repository';
import { TavilyResearchSearchAdapter } from './research-search.adapter';
import { ResearchAgentService } from './research-agent.service';

@Module({
  controllers: [ChatController],
  providers: [
    ChatService,
    ResearchAgentService,
    InMemoryChatRepository,
    TavilyResearchSearchAdapter,
  ],
})
export class ChatModule {}
