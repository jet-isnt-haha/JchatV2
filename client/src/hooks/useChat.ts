import { useChatContext } from "@/providers/chat/ChatProvider";

export function useChat() {
  return useChatContext();
}
