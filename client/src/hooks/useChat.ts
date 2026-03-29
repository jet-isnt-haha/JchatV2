import { useState, useRef } from 'react';
import type { ChatMessage, ChatRequest, ChatStartResponse, ChatStreamChunk } from '@jchat/shared';

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  async function sendMessage(content: string) {
    if (isLoading) return;

    const userMessage: ChatMessage = { role: 'user', content };
    const messagesToSend = [...messagesRef.current, userMessage];

    setMessages([...messagesToSend, { role: 'assistant', content: '' }]);
    setIsLoading(true);

    try {
      // 第一步：POST 消息列表，获取 chatId
      const request: ChatRequest = { messages: messagesToSend };
      const startRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!startRes.ok) throw new Error(`HTTP ${startRes.status}`);

      const { chatId }: ChatStartResponse = await startRes.json();

      // 第二步：用 EventSource 建立 SSE 连接接收流式输出
      await receiveStream(chatId);
    } catch (err) {
      console.error('Chat error:', err);
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (!last.content) {
          next[next.length - 1] = { ...last, content: '发生错误，请重试。' };
        }
        return next;
      });
    } finally {
      setIsLoading(false);
    }
  }

  function receiveStream(chatId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const source = new EventSource(`/api/chat/${chatId}/stream`);

      source.onmessage = (event) => {
        const chunk: ChatStreamChunk = JSON.parse(event.data as string);
        if (chunk.done) {
          source.close();
          resolve();
          return;
        }
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, content: last.content + chunk.content };
          return next;
        });
      };

      source.onerror = () => {
        source.close();
        reject(new Error('SSE connection error'));
      };
    });
  }

  return { messages, isLoading, sendMessage };
}
