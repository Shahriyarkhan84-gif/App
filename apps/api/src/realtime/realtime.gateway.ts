import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

import { ChatService } from '../chat/chat.service';
import type { JwtPayload } from '../auth/jwt.strategy';

type AuthedSocket = Socket & { data: { user: JwtPayload } };

/**
 * Replaces Supabase Realtime for room chat, DMs and notifications (see
 * docs/MIGRATION_PLAN.md, Phase 4). Every connected client joins a personal
 * `user:<id>` room, so any service can push to a specific user via
 * emitToUser() without knowing which socket/instance they're on — the Redis
 * adapter (see redis-io.adapter.ts) fans that out across API instances.
 */
@WebSocketGateway({ cors: { origin: '*' } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly chat: ChatService,
  ) {}

  handleConnection(client: Socket) {
    const token = client.handshake.auth?.token ?? client.handshake.headers.authorization?.replace('Bearer ', '');
    if (!token) return this.reject(client, 'Missing token');

    try {
      const payload = this.jwt.verify<JwtPayload>(token, { secret: this.config.getOrThrow<string>('JWT_SECRET') });
      (client as AuthedSocket).data.user = payload;
      client.join(`user:${payload.sub}`);
    } catch {
      this.reject(client, 'Invalid token');
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Disconnected: ${client.id}`);
  }

  @SubscribeMessage('room:join')
  onRoomJoin(@ConnectedSocket() client: Socket, @MessageBody() body: { roomId: string }) {
    client.join(`room:${body.roomId}`);
  }

  @SubscribeMessage('room:leave')
  onRoomLeave(@ConnectedSocket() client: Socket, @MessageBody() body: { roomId: string }) {
    client.leave(`room:${body.roomId}`);
  }

  @SubscribeMessage('chat:send')
  async onChatSend(@ConnectedSocket() client: AuthedSocket, @MessageBody() body: { roomId: string; body: string }) {
    try {
      const message = await this.chat.sendRoomMessage(client.data.user.sub, body.roomId, body.body);
      this.server.to(`room:${body.roomId}`).emit('chat:message', message);
    } catch (err) {
      client.emit('error', { event: 'chat:send', message: (err as Error).message });
    }
  }

  @SubscribeMessage('dm:send')
  async onDmSend(@ConnectedSocket() client: AuthedSocket, @MessageBody() body: { recipientId: string; body: string }) {
    try {
      const dm = await this.chat.sendDirectMessage(client.data.user.sub, body.recipientId, body.body);
      this.server.to(`user:${body.recipientId}`).emit('dm:message', dm);
      client.emit('dm:message', dm);
    } catch (err) {
      client.emit('error', { event: 'dm:send', message: (err as Error).message });
    }
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  emitToRoom(roomId: string, event: string, payload: unknown) {
    this.server.to(`room:${roomId}`).emit(event, payload);
  }

  private reject(client: Socket, message: string) {
    client.emit('error', { message });
    client.disconnect(true);
  }
}
