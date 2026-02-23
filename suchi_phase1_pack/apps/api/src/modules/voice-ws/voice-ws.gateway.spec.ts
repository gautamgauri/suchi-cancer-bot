import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { VoiceWsGateway } from './voice-ws.gateway';
import { VoiceStreamService, StreamingSession } from './voice-stream.service';
import { VoiceService } from '../voice/voice.service';

describe('VoiceWsGateway', () => {
  let gateway: VoiceWsGateway;
  let voiceStreamService: VoiceStreamService;
  let voiceService: VoiceService;

  const mockSocket = {
    id: 'test-socket-id',
    emit: jest.fn(),
    disconnect: jest.fn(),
  } as any;

  const mockStreamingSession = {
    write: jest.fn(),
    end: jest.fn(),
    destroy: jest.fn(),
    setFinalResult: jest.fn(),
    setError: jest.fn(),
  } as unknown as StreamingSession;

  beforeEach(async () => {
    jest.useFakeTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceWsGateway,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'VOICE_WS_IDLE_TIMEOUT_MS') return 30000;
              if (key === 'VOICE_WS_MAX_SESSION_MS') return 60000;
              return undefined;
            }),
          },
        },
        {
          provide: VoiceStreamService,
          useValue: {
            createStream: jest.fn().mockReturnValue(mockStreamingSession),
          },
        },
        {
          provide: VoiceService,
          useValue: {
            handleVoiceRequestFromTranscript: jest.fn().mockResolvedValue({
              messageId: 'msg-123',
              responseText: 'Cancer information response',
              voiceText: 'Cancer information response',
              audioUrl: 'https://storage.example.com/audio.mp3',
              safety: { classification: 'normal', actions: [] },
              chatMs: 200,
              ttsMs: 150,
            }),
          },
        },
      ],
    }).compile();

    gateway = module.get(VoiceWsGateway);
    voiceStreamService = module.get(VoiceStreamService);
    voiceService = module.get(VoiceService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('should register client on connection', () => {
    gateway.handleConnection(mockSocket);
    expect((gateway as any).clients.has('test-socket-id')).toBe(true);
  });

  it('should cleanup client on disconnect', () => {
    gateway.handleConnection(mockSocket);
    gateway.handleDisconnect(mockSocket);
    expect((gateway as any).clients.has('test-socket-id')).toBe(false);
  });

  it('should create streaming session on audio:start', () => {
    gateway.handleConnection(mockSocket);
    gateway.handleAudioStart(mockSocket, {
      sessionId: 'session-123',
      locale: 'hi-IN',
    });

    expect(voiceStreamService.createStream).toHaveBeenCalledWith(
      'hi-IN',
      expect.any(Function),
    );
    expect(mockSocket.emit).toHaveBeenCalledWith('audio:ready', {
      status: 'streaming',
    });
  });

  it('should emit error if sessionId is missing', () => {
    gateway.handleConnection(mockSocket);
    gateway.handleAudioStart(mockSocket, { sessionId: '' });

    expect(mockSocket.emit).toHaveBeenCalledWith('error', {
      code: 'MISSING_SESSION_ID',
      message: 'sessionId is required',
    });
  });

  it('should write chunks to streaming session', () => {
    gateway.handleConnection(mockSocket);
    gateway.handleAudioStart(mockSocket, {
      sessionId: 'session-123',
    });

    const chunk = Buffer.from('fake-pcm-data');
    gateway.handleAudioChunk(mockSocket, chunk);

    expect(mockStreamingSession.write).toHaveBeenCalledWith(chunk);
  });

  it('should emit error if no stream on audio:chunk', () => {
    gateway.handleConnection(mockSocket);
    gateway.handleAudioChunk(mockSocket, Buffer.from('data'));

    expect(mockSocket.emit).toHaveBeenCalledWith('error', {
      code: 'NO_STREAM',
      message: 'Call audio:start first',
    });
  });

  it('should process full pipeline on audio:end', async () => {
    gateway.handleConnection(mockSocket);
    gateway.handleAudioStart(mockSocket, {
      sessionId: 'session-123',
      locale: 'hi-IN',
    });

    (mockStreamingSession.end as jest.Mock).mockResolvedValue({
      transcript: 'I have breast cancer',
      confidence: 0.95,
      languageCode: 'en-IN',
    });

    await gateway.handleAudioEnd(mockSocket);

    expect(mockSocket.emit).toHaveBeenCalledWith('stt:final', {
      transcript: 'I have breast cancer',
      confidence: 0.95,
      languageCode: 'en-IN',
    });

    expect(voiceService.handleVoiceRequestFromTranscript).toHaveBeenCalledWith(
      'session-123',
      'I have breast cancer',
      'hi-IN',
    );

    expect(mockSocket.emit).toHaveBeenCalledWith(
      'response',
      expect.objectContaining({
        messageId: 'msg-123',
        responseText: 'Cancer information response',
        audioUrl: 'https://storage.example.com/audio.mp3',
      }),
    );
  });

  it('should disconnect on max session timeout', () => {
    gateway.handleConnection(mockSocket);

    jest.advanceTimersByTime(60001);

    expect(mockSocket.emit).toHaveBeenCalledWith('error', {
      code: 'MAX_SESSION_TIMEOUT',
      message: 'Maximum session duration exceeded',
    });
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it('should disconnect on idle timeout', () => {
    gateway.handleConnection(mockSocket);
    gateway.handleAudioStart(mockSocket, {
      sessionId: 'session-123',
    });

    jest.advanceTimersByTime(30001);

    expect(mockSocket.emit).toHaveBeenCalledWith('error', {
      code: 'IDLE_TIMEOUT',
      message: 'No audio received within timeout',
    });
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it('should reset idle timer on audio:chunk', () => {
    gateway.handleConnection(mockSocket);
    gateway.handleAudioStart(mockSocket, {
      sessionId: 'session-123',
    });

    // Advance 20s
    jest.advanceTimersByTime(20000);

    // Send chunk — should reset timer
    gateway.handleAudioChunk(mockSocket, Buffer.from('data'));

    // Advance another 20s (total 40s from start, but only 20s from last chunk)
    jest.advanceTimersByTime(20000);

    // Should NOT have timed out yet
    expect(mockSocket.disconnect).not.toHaveBeenCalled();
  });
});
