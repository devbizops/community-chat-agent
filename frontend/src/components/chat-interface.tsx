/**
 * Chat Interface Component
 *
 * Minimal chat surface that forwards prompts to the agent proxy-backed API.
 */

'use client'

import React, { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChatMessage, ChatRequest, ChatResponse } from '@/types/chat';

const samplePrompts = [
  'Summarize our community KPIs.',
  'What should I focus on to improve member retention?',
  'Draft a community update for executives.',
  'Outline next steps after our latest launch event.'
];

const createId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export default function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const userMessage: ChatMessage = {
      id: createId(),
      role: 'user',
      content: trimmed,
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            ...messages.slice(-4).map(({ role, content }) => ({ role, content })),
            { role: userMessage.role, content: userMessage.content },
          ],
        } satisfies ChatRequest),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        const message = errorPayload?.error?.userMessage || errorPayload?.error?.message || 'Failed to send message';
        throw new Error(message);
      }

      const payload = await response.json();
      const data: ChatResponse | undefined = payload?.data;

      const assistantMessage: ChatMessage = {
        id: createId(),
        role: 'assistant',
        content: data?.content?.trim() || 'I did not receive any content back from the agent.',
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      const fallback: ChatMessage = {
        id: createId(),
        role: 'assistant',
        content: `Sorry, something went wrong: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
      setMessages(prev => [...prev, fallback]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    sendMessage();
  };

  return (
    <div className="max-w-4xl mx-auto p-6 min-h-screen bg-gray-50">
      <header className="text-center mb-8">
        <div className="flex items-center justify-center mb-3">
          <div className="w-10 h-10 bg-red-500 rounded-full flex items-center justify-center text-white font-bold mr-3">
            *
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900" style={{ fontFamily: 'Publica Sans, system-ui, sans-serif' }}>
              CommunityGPT
            </h1>
            <p className="text-sm text-gray-500" style={{ fontFamily: 'Manrope, system-ui, sans-serif' }}>
              Powered by TRIBE<span className="text-red-500">ROI</span>
            </p>
          </div>
        </div>
        <p className="text-gray-600" style={{ fontFamily: 'Manrope, system-ui, sans-serif' }}>
          Ask about metrics, programs, or strategy and the agent engine will keep the context for you.
        </p>
      </header>

      <section className="bg-white rounded-xl shadow border border-gray-200 mb-6">
        <div className="max-h-[540px] overflow-y-auto p-6 space-y-6">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <p className="text-lg text-gray-700 mb-6" style={{ fontFamily: 'Manrope, system-ui, sans-serif' }}>
                Try one of these starter prompts:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl mx-auto">
                {samplePrompts.map(prompt => (
                  <button
                    key={prompt}
                    onClick={() => setInput(prompt)}
                    disabled={isLoading}
                    className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-left text-sm text-gray-700 hover:bg-gray-100 focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 transition"
                    style={{ fontFamily: 'Manrope, system-ui, sans-serif' }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(message => (
            <div
              key={message.id}
              className={`flex items-start gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {message.role === 'assistant' && (
                <div className="flex-shrink-0 w-9 h-9 bg-red-500 rounded-full flex items-center justify-center text-white font-semibold">
                  *
                </div>
              )}

              <div className={`max-w-[80%] ${message.role === 'user' ? 'ml-auto' : ''}`}>
                <div
                  className={`rounded-xl p-4 leading-relaxed ${
                    message.role === 'user'
                      ? 'bg-blue-600 text-white shadow'
                      : 'bg-gray-50 text-gray-800 border border-gray-200'
                  }`}
                  style={{ fontFamily: 'Manrope, system-ui, sans-serif' }}
                >
                  {message.content}
                </div>
              </div>

              {message.role === 'user' && (
                <div className="flex-shrink-0 w-9 h-9 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-semibold">
                  You
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-9 h-9 bg-red-500 rounded-full flex items-center justify-center text-white font-semibold">
                *
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-red-500 mb-2" style={{ fontFamily: 'Publica Sans, system-ui, sans-serif' }}>
                  CommunityGPT
                </p>
                <div className="flex items-center gap-2 text-gray-600" style={{ fontFamily: 'Manrope, system-ui, sans-serif' }}>
                  <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-500" />
                  Thinking through the best answer...
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 p-4">
          <form onSubmit={handleSubmit} className="flex gap-3">
            <Input
              value={input}
              onChange={event => setInput(event.target.value)}
              placeholder="Ask about community metrics, programs, or strategy..."
              disabled={isLoading}
              className="flex-1 border-gray-300 focus:ring-red-500 focus:border-red-500"
              style={{ fontFamily: 'Manrope, system-ui, sans-serif' }}
            />
            <Button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="bg-red-500 hover:bg-red-600 text-white px-6 font-medium"
              style={{ fontFamily: 'Manrope, system-ui, sans-serif' }}
            >
              {isLoading ? 'Sending...' : 'Send'}
            </Button>
          </form>
        </div>
      </section>

      <footer className="text-center text-gray-500 text-sm" style={{ fontFamily: 'Manrope, system-ui, sans-serif' }}>
        Made with ❤️ by TRIBE<span className="text-red-500">ROI</span> • Powered by the Vertex AI Agent Engine
      </footer>
    </div>
  );
}
