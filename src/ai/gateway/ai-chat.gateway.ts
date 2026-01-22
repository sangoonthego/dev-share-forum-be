import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Socket, Server } from 'socket.io';
import { AiAgentService } from '../services/ai-agent.service';
import * as Sentry from '@sentry/nestjs';

interface AuthenticatedSocket extends Socket {
  userId?: number;
  email?: string;
}

/**
 * AiChatGateway - WebSocket gateway for real-time AI chat
 * 
 * Events:
 * - connect: User connects to chat
 * - ask_ai: Send message to AI agent
 * - stream_response: Receive streamed response chunks
 * - sources: Receive citation sources
 * - error: Handle errors
 * 
 * Features:
 * - Real-time streaming responses (typing effect)
 * - Session-based multi-turn conversations
 * - Authentication via JWT
 * - Sentry monitoring for all events
 */
@WebSocketGateway({
  namespace: 'chat',
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  },
  transports: ['websocket'],
})
export class AiChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(AiChatGateway.name);
  private server: Server;
  private activeConnections = new Map<string, AuthenticatedSocket>();

  constructor(private readonly aiAgentService: AiAgentService) {}

  afterInit(server: Server) {
    this.server = server;
    this.logger.log('AI Chat Gateway initialized');
  }

  handleConnection(client: AuthenticatedSocket) {
    try {
      // Extract user info from JWT token
      const token = client.handshake.auth.token;
      if (!token) {
        client.emit('error', { message: 'Authentication required' });
        client.disconnect();
        return;
      }

      // In production, validate JWT here
      // For now, extract from socket data
      const userId = client.handshake.auth.userId;
      const email = client.handshake.auth.email;

      if (!userId) {
        client.emit('error', { message: 'Invalid user' });
        client.disconnect();
        return;
      }

      client.userId = userId;
      client.email = email;

      this.activeConnections.set(client.id, client);

      Sentry.captureMessage(
        `User #${userId} connected to chat (socket: ${client.id})`,
        'info',
      );

      this.logger.log(
        `Client connected: ${client.id} (User #${userId})`,
      );
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { event: 'gateway_connection' },
      });
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    const userId = client.userId;
    
    // Remove from active connections to prevent memory leak
    this.activeConnections.delete(client.id);
    
    // Remove all listeners from this socket
    client.removeAllListeners();
    
    Sentry.captureMessage(
      `User #${userId} disconnected from chat`,
      'info',
    );

    this.logger.log(`Client disconnected: ${client.id} (Active: ${this.activeConnections.size})`);
  }

  /**
   * Handle ask_ai event
   * Streams response chunks in real-time
   * Wraps entire request in Root Span (Transaction) for observability
   */
  @SubscribeMessage('ask_ai')
  async handleAskAi(
    @MessageBody()
    data: { message: string; sessionId?: string },
    @ConnectedSocket() client: AuthenticatedSocket,
  ): Promise<void> {
    // ROOT SPAN: Entire WebSocket ask_ai transaction
    return Sentry.startSpan(
      {
        name: 'ws.ask_ai',
        op: 'websocket.message',
        attributes: {
          'user.id': client.userId,
          'session.id': data.sessionId || 'new',
          'socket.id': client.id,
          'message.length': data.message?.length || 0,
          'message.truncated': (data.message?.length || 0) > 2000,
        },
      },
      async (rootSpan) => {
        try {
          if (!client.userId) {
            client.emit('error', { message: 'Not authenticated' });
            rootSpan?.setStatus({ code: 2 as any, message: 'Not authenticated' });
            return;
          }

          const { message, sessionId } = data;

          if (!message || message.trim().length === 0) {
            client.emit('error', { message: 'Message cannot be empty' });
            rootSpan?.setStatus({ code: 2 as any, message: 'Empty message' });
            return;
          }

          if (message.length > 2000) {
            client.emit('error', { message: 'Message too long (max 2000 chars)' });
            rootSpan?.setStatus({ code: 2 as any, message: 'Message too long' });
            return;
          }

          this.logger.debug(
            `Query received from user #${client.userId} (length: ${message.length} chars)`,
          );

          // Start streaming response
          let fullResponse = '';
          let sources: Array<{ title: string; slug: string }> = [];
          let finalSessionId = sessionId || 'new';

          try {
            // Get agent response (service level spans are created in aiAgentService)
            const result = await this.aiAgentService.executeAgent(
              message,
              client.userId,
              sessionId,
            );

            fullResponse = result.response;
            sources = result.sources;
            finalSessionId = result.sessionId;

            // Update root span with results
            rootSpan?.setAttributes({
              'response.length': fullResponse.length,
              'response.sources_count': sources.length,
              'session.final_id': finalSessionId,
            });

            // Emit response in chunks for typing effect
            const chunkSize = 20;
            for (let i = 0; i < fullResponse.length; i += chunkSize) {
              const chunk = fullResponse.substring(i, i + chunkSize);
              client.emit('stream_response', {
                chunk,
                isDone: false,
              });

              // Small delay for typing effect
              await new Promise((resolve) => setTimeout(resolve, 30));
            }

            // Send final message and sources
            client.emit('stream_response', {
              chunk: '',
              isDone: true,
              sessionId: finalSessionId,
            });

            if (sources.length > 0) {
              client.emit('sources', {
                sources,
              });
            }

            rootSpan?.setStatus({ code: 0 as any }); // Ok

            Sentry.captureMessage(
              `Response sent to user #${client.userId} (response: ${fullResponse.length} chars, sources: ${sources.length})`,
              'info',
            );
          } catch (error: any) {
            rootSpan?.setStatus({ code: 2 as any, message: error.message });

            // Capture exception linked to active span
            Sentry.captureException(error, {
              tags: {
                event: 'ask_ai',
                userId: client.userId?.toString(),
                phase: 'agent_execution',
              },
              attributes: {
                'user.id': client.userId,
                'session.id': sessionId,
                'message.length': message.length,
                'error.recoverable': false,
              },
            });

            this.logger.error(`Error processing query: ${error.message}`);

            client.emit('error', {
              message: 'Failed to process query. Please try again.',
              error: error.message,
            });
          }
        } catch (error: any) {
          rootSpan?.setStatus({ code: 2 as any, message: error.message });

          // Capture exception linked to active span
          Sentry.captureException(error, {
            tags: {
              event: 'gateway_ask_ai',
              userId: client.userId?.toString(),
            },
            attributes: {
              'user.id': client.userId,
              'error.phase': 'gateway_level',
              'socket.id': client.id,
            },
          });

          client.emit('error', {
            message: 'Internal server error',
          });
        }
      },
    );
  }

  /**
   * Handle clear_session event
   * Clear chat history for a session
   */
  @SubscribeMessage('clear_session')
  async handleClearSession(
    @MessageBody() data: { sessionId: string },
    @ConnectedSocket() client: AuthenticatedSocket,
  ): Promise<void> {


    try {
      if (!client.userId) {
        client.emit('error', { message: 'Not authenticated' });
        return;
      }

      const { sessionId } = data;

      if (!sessionId) {
        client.emit('error', { message: 'Session ID required' });
        return;
      }

      await this.aiAgentService.clearSession(client.userId, sessionId);

      client.emit('session_cleared', { sessionId });


      this.logger.log(
        `Session ${sessionId} cleared for user #${client.userId}`,
      );
    } catch (error: any) {

      Sentry.captureException(error, {
        tags: { event: 'clear_session' },
      });

      client.emit('error', {
        message: 'Failed to clear session',
      });
    } finally {

    }
  }

  /**
   * Handle get_sessions event
   * List active sessions for user
   */
  @SubscribeMessage('get_sessions')
  async handleGetSessions(
    @ConnectedSocket() client: AuthenticatedSocket,
  ): Promise<void> {


    try {
      if (!client.userId) {
        client.emit('error', { message: 'Not authenticated' });
        return;
      }

      // In production, retrieve sessions from Redis
      // For now, send empty list
      client.emit('sessions', { sessions: [] });


    } catch (error: any) {

      Sentry.captureException(error, {
        tags: { event: 'get_sessions' },
      });

      client.emit('error', { message: 'Failed to retrieve sessions' });
    } finally {

    }
  }

  /**
   * Broadcast message to all connected users (for admin use)
   */
  broadcastMessage(
    message: string,
    sourceUserId?: number,
  ): void {
    this.server.emit('admin_broadcast', {
      message,
      timestamp: Date.now(),
      sourceUserId,
    });
  }

  /**
   * Send direct message to specific user
   */
  sendToUser(
    userId: number,
    event: string,
    data: any,
  ): void {
    for (const [, client] of this.activeConnections) {
      if (client.userId === userId) {
        client.emit(event, data);
      }
    }
  }

  /**
   * Get active connection count
   */
  getActiveConnectionCount(): number {
    return this.activeConnections.size;
  }
}
