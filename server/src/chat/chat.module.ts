import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { InMemoryChatRepository } from './chat.repository';

@Module({
  controllers: [ChatController],
  providers: [ChatService, InMemoryChatRepository],
})
export class ChatModule {}
