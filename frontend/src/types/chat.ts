export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: Array<Pick<ChatMessage, 'role' | 'content'>>;
}

export interface ChatResponse {
  content: string;
}
