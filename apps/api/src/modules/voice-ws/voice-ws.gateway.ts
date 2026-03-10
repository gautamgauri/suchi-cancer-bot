import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { VoiceStreamService, StreamingSession } from './voice-stream.service';
import { VoiceService } from '../voice/voice.service';

interface ClientSession {
  streamingSession: StreamingSession | null;
  sessionId: string | null;
  locale: string;
  idleTimer: ReturnType<typeof setTimeout> | null;
  maxTimer: ReturnType<typeof setTimeout> | null;
  started: number;
}

@WebSocketGateway({
  namespace: '/v1/voice/stream',
  cors: { origin: '*' },
})
export class VoiceWsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(VoiceWsGateway.name);
  private readonly clients = new Map<string, ClientSession>();
  private readonly idleTimeoutMs: number;
  private readonly maxSessionMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly voiceStreamService: VoiceStreamService,
    private readonly voiceService: VoiceService,
  ) {
    this.idleTimeoutMs =
      this.config.get<number>('VOICE_WS_IDLE_TIMEOUT_MS') || 30000;
    this.maxSessionMs =
      this.config.get<number>('VOICE_WS_MAX_SESSION_MS') || 60000;
  }

  handleConnection(client: Socket) {
    this.logger.log(`WS client connected: ${client.id}`);
    this.clients.set(client.id, {
      streamingSession: null,
      sessionId: null,
      locale: 'hi-IN',
      idleTimer: null,
      maxTimer: null,
      started: Date.now(),
    });

    // Max session timeout
    const maxTimer = setTimeout(() => {
      this.logger.warn(`WS max session timeout: ${client.id}`);
      client.emit('error', { code: 'MAX_SESSION_TIMEOUT', message: 'Maximum session duration exceeded' });
      client.disconnect();
    }, this.maxSessionMs);

    const session = this.clients.get(client.id)!;
    session.maxTimer = maxTimer;
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`WS client disconnected: ${client.id}`);
    this.cleanupClient(client.id);
  }

  @SubscribeMessage('audio:start')
  handleAudioStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; locale?: string },
  ) {
    const session = this.clients.get(client.id);
    if (!session) {
      client.emit('error', { code: 'NO_SESSION', message: 'Not connected' });
      return;
    }

    if (!data?.sessionId) {
      client.emit('error', { code: 'MISSING_SESSION_ID', message: 'sessionId is required' });
      return;
    }

    session.sessionId = data.sessionId;
    session.locale = data.locale || 'hi-IN';

    // Create streaming STT session
    session.streamingSession = this.voiceStreamService.createStream(
      session.locale,
      (interimTranscript) => {
        client.emit('stt:interim', { transcript: interimTranscript });
      },
    );

    this.resetIdleTimer(client.id, client);

    this.logger.log({
      event: 'ws_audio_start',
      clientId: client.id,
      sessionId: data.sessionId,
      locale: session.locale,
    });

    client.emit('audio:ready', { status: 'streaming' });
  }

  @SubscribeMessage('audio:chunk')
  handleAudioChunk(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: Buffer,
  ) {
    const session = this.clients.get(client.id);
    if (!session?.streamingSession) {
      client.emit('error', { code: 'NO_STREAM', message: 'Call audio:start first' });
      return;
    }

    session.streamingSession.write(data);
    this.resetIdleTimer(client.id, client);
  }

  @SubscribeMessage('audio:end')
  async handleAudioEnd(@ConnectedSocket() client: Socket) {
    const session = this.clients.get(client.id);
    if (!session?.streamingSession || !session.sessionId) {
      client.emit('error', { code: 'NO_STREAM', message: 'No active stream' });
      return;
    }

    this.clearIdleTimer(client.id);

    try {
      // Get final STT result
      const sttResult = await session.streamingSession.end();
      client.emit('stt:final', {
        transcript: sttResult.transcript,
        confidence: sttResult.confidence,
        languageCode: sttResult.languageCode,
      });

      if (!sttResult.transcript) {
        client.emit('error', { code: 'EMPTY_TRANSCRIPT', message: 'No speech detected' });
        return;
      }

      // Run pipeline (Chat → TTS → GCS)
      const pipelineResult =
        await this.voiceService.handleVoiceRequestFromTranscript(
          session.sessionId,
          sttResult.transcript,
          session.locale,
        );

      client.emit('response', {
        messageId: pipelineResult.messageId,
        transcript: sttResult.transcript,
        confidence: sttResult.confidence,
        responseText: pipelineResult.responseText,
        voiceResponseText: pipelineResult.voiceText,
        audioUrl: pipelineResult.audioUrl,
        safety: pipelineResult.safety,
        latency: {
          chatMs: pipelineResult.chatMs,
          ttsMs: pipelineResult.ttsMs,
        },
      });
    } catch (err: any) {
      this.logger.error(`WS pipeline error: ${err.message}`, err.stack);
      client.emit('error', {
        code: 'PIPELINE_ERROR',
        message: 'Failed to process voice request',
      });
    } finally {
      // Cleanup streaming session, allow new stream
      session.streamingSession?.destroy();
      session.streamingSession = null;
    }
  }

  private resetIdleTimer(clientId: string, client: Socket) {
    this.clearIdleTimer(clientId);
    const session = this.clients.get(clientId);
    if (session) {
      session.idleTimer = setTimeout(() => {
        this.logger.warn(`WS idle timeout: ${clientId}`);
        client.emit('error', { code: 'IDLE_TIMEOUT', message: 'No audio received within timeout' });
        client.disconnect();
      }, this.idleTimeoutMs);
    }
  }

  private clearIdleTimer(clientId: string) {
    const session = this.clients.get(clientId);
    if (session?.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
  }

  private cleanupClient(clientId: string) {
    const session = this.clients.get(clientId);
    if (session) {
      if (session.idleTimer) clearTimeout(session.idleTimer);
      if (session.maxTimer) clearTimeout(session.maxTimer);
      session.streamingSession?.destroy();
      this.clients.delete(clientId);
    }
  }
}
