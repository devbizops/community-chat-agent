/**
 * Chat API Route
 * 
 * Handles chat requests through the agent engine proxy.
 * Provides simple JSON responses to the frontend chat UI.
 */

// External dependencies
import { NextRequest } from 'next/server';
import { queryAgentProxy } from '@/lib/proxy';

// Type definitions
import { ChatRequest, ChatResponse } from '@/types/chat';

type Metadata = {
  timestamp: string;
  processingTime: number;
};

type ApiSuccess = {
  success: true;
  data: ChatResponse;
  metadata: Metadata;
};

type ApiError = {
  success: false;
  error: {
    message: string;
    code: string;
    context?: Record<string, unknown>;
  };
  metadata: Metadata;
};

function buildMetadata(startTime: number): Metadata {
  return {
    timestamp: new Date().toISOString(),
    processingTime: Date.now() - startTime,
  };
}

function validationError(message: string, startTime: number, context?: Record<string, unknown>) {
  const payload: ApiError = {
    success: false,
    error: {
      message,
      code: 'VALIDATION_FAILED',
      context,
    },
    metadata: buildMetadata(startTime),
  };
  return Response.json(payload, { status: 400 });
}

function internalError(message: string, startTime: number, context?: Record<string, unknown>) {
  const payload: ApiError = {
    success: false,
    error: {
      message,
      code: 'INTERNAL_SERVER_ERROR',
      context,
    },
    metadata: buildMetadata(startTime),
  };
  return Response.json(payload, { status: 500 });
}

function successResponse(data: ChatResponse, startTime: number) {
  const payload: ApiSuccess = {
    success: true,
    data,
    metadata: buildMetadata(startTime),
  };
  return Response.json(payload, { status: 200 });
}

// ============================================================================
// API ROUTE HANDLER
// ============================================================================

/**
 * POST /api/chat
 * 
 * Handles chat requests through the agent engine proxy.
 * 
 * @param request - Next.js request object containing chat messages
 * @returns JSON response with chat content
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let userQuery: string | undefined;
  
  try {
    const body: ChatRequest = await request.json();
    const { messages } = body;
    
    // Validate request
    if (!messages || messages.length === 0) {
      return validationError('No messages provided', startTime, { requestBody: body });
    }

    userQuery = messages[messages.length - 1].content;
    
    if (!userQuery || userQuery.trim().length === 0) {
      return validationError('Empty message content', startTime, { messageCount: messages.length });
    }

    const headers: Record<string, string> = {};
    if (process.env.PROXY_API_KEY) headers['x-api-key'] = process.env.PROXY_API_KEY; // optional
    const { text } = await queryAgentProxy(userQuery, headers);
    const chatResponse: ChatResponse = { content: text ?? '' };

    return successResponse(chatResponse, startTime);

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error calling the agent.';
    const context = userQuery ? { userQuery: userQuery.substring(0, 100) } : undefined;
    return internalError(message, startTime, context);
  }
}
