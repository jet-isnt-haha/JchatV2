export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
}

export interface ChatStartResponse {
  chatId: string;
}

export interface ChatStreamChunk {
  content: string;
  done: boolean;
}
