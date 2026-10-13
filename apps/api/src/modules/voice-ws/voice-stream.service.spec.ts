import { EventEmitter } from 'events';
import { ConfigService } from '@nestjs/config';

/**
 * Fake of the duplex stream returned by SpeechClient.streamingRecognize().
 * end() is a half-close: the recognizer keeps emitting results afterwards
 * and only emits 'end' when the test says the server has flushed.
 */
class FakeRecognizeStream extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  written: Buffer[] = [];
  write = jest.fn((chunk: Buffer) => {
    this.written.push(chunk);
    return true;
  });
  end = jest.fn(() => {
    this.writableEnded = true;
  });
  destroy = jest.fn(() => {
    this.destroyed = true;
  });

  final(transcript: string, confidence = 0.9, languageCode = 'en-in') {
    this.emit('data', {
      results: [{ isFinal: true, alternatives: [{ transcript, confidence }], languageCode }],
    });
  }
  interim(transcript: string) {
    this.emit('data', {
      results: [{ isFinal: false, alternatives: [{ transcript }] }],
    });
  }
  serverDone() {
    this.emit('end');
    this.emit('close');
  }
}

const streams: FakeRecognizeStream[] = [];
const mockStreamingRecognize = jest.fn(() => {
  const s = new FakeRecognizeStream();
  streams.push(s);
  return s;
});
const mockClose = jest.fn().mockResolvedValue(undefined);
const mockSpeechClientCtor = jest.fn();

jest.mock('@google-cloud/speech', () => ({
  SpeechClient: jest.fn().mockImplementation(() => {
    mockSpeechClientCtor();
    return { streamingRecognize: mockStreamingRecognize, close: mockClose };
  }),
}));

// Imported after the mock is registered.
import { VoiceStreamService, STREAM_END_TIMEOUT_MS } from './voice-stream.service';

describe('VoiceStreamService / StreamingSession', () => {
  let service: VoiceStreamService;

  beforeEach(() => {
    streams.length = 0;
    jest.clearAllMocks();
    service = new VoiceStreamService({ get: jest.fn() } as unknown as ConfigService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps every final across a pause, in order, joined with a space', async () => {
    const session = service.createStream('en-IN');
    const s = streams[0];

    s.final('I found a lump in my breast.');
    // speaker pauses; recognizer closes that utterance and starts another
    s.final('It has been bleeding since yesterday.');

    const pending = session.end();
    s.serverDone();
    const result = await pending;

    expect(result.transcript).toBe(
      'I found a lump in my breast. It has been bleeding since yesterday.',
    );
    expect(result.confidence).toBeCloseTo(0.9);
    expect(result.languageCode).toBe('en-in');
  });

  it('reads every result in a data event, not only results[0]', async () => {
    const session = service.createStream('en-IN');
    const s = streams[0];
    s.emit('data', {
      results: [
        { isFinal: true, alternatives: [{ transcript: 'First part.', confidence: 0.8 }] },
        { isFinal: true, alternatives: [{ transcript: 'Second part.', confidence: 0.6 }] },
      ],
    });
    const pending = session.end();
    s.serverDone();
    expect((await pending).transcript).toBe('First part. Second part.');
  });

  it('ignores interim results in the transcript but reports them to onInterim', async () => {
    const onInterim = jest.fn();
    const session = service.createStream('en-IN', onInterim);
    const s = streams[0];

    s.interim('I have');
    s.interim('I have a cough');
    s.final('I have a cough.');
    s.interim('for three');

    const pending = session.end();
    s.serverDone();
    const result = await pending;

    expect(result.transcript).toBe('I have a cough.');
    expect(onInterim).toHaveBeenNthCalledWith(1, 'I have');
    expect(onInterim).toHaveBeenLastCalledWith('I have a cough. for three');
  });

  it('end() after a final still half-closes the stream and waits for the stream end', async () => {
    const session = service.createStream('en-IN');
    const s = streams[0];

    s.final('I have a fever.');
    let settled = false;
    const pending = session.end().then((r) => {
      settled = true;
      return r;
    });

    expect(s.end).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(settled).toBe(false);

    // Audio sent after the first pause is still flushed by the recognizer.
    s.final('And my gums are bleeding.');
    s.serverDone();

    const result = await pending;
    expect(result.transcript).toBe('I have a fever. And my gums are bleeding.');
  });

  it('times out with the accumulated text and clears its timer', async () => {
    jest.useFakeTimers();
    const session = service.createStream('en-IN');
    const s = streams[0];

    s.final('Partial sentence.');
    const pending = session.end();
    jest.advanceTimersByTime(STREAM_END_TIMEOUT_MS + 1);
    const result = await pending;

    expect(result.transcript).toBe('Partial sentence.');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears the end timer when the stream finishes before the timeout', async () => {
    jest.useFakeTimers();
    const session = service.createStream('en-IN');
    const s = streams[0];
    const pending = session.end();
    expect(jest.getTimerCount()).toBe(1);
    s.final('Done.');
    s.serverDone();
    await pending;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('returns an empty transcript (not an error) when nothing was said', async () => {
    const session = service.createStream('hi-IN');
    const pending = session.end();
    streams[0].serverDone();
    expect(await pending).toEqual({ transcript: '', confidence: 0, languageCode: 'hi-IN' });
  });

  it('rejects when the stream errors before any speech was captured', async () => {
    const session = service.createStream('en-IN');
    const pending = session.end();
    streams[0].emit('error', new Error('boom'));
    await expect(pending).rejects.toThrow('boom');
  });

  it('keeps what was said when the stream errors after a final', async () => {
    const session = service.createStream('en-IN');
    streams[0].final('I am vomiting blood.');
    const pending = session.end();
    streams[0].emit('error', new Error('late failure'));
    expect((await pending).transcript).toBe('I am vomiting blood.');
  });

  it('end() is idempotent and destroy() releases a pending end()', async () => {
    const session = service.createStream('en-IN');
    streams[0].final('Hello.');
    const a = session.end();
    const b = session.end();
    expect(a).toBe(b);
    expect(streams[0].end).toHaveBeenCalledTimes(1);
    session.destroy();
    expect((await a).transcript).toBe('Hello.');
    expect(streams[0].destroy).toHaveBeenCalled();
  });

  it('stops writing audio once end() has been called', () => {
    const session = service.createStream('en-IN');
    session.write(Buffer.from('a'));
    session.end();
    session.write(Buffer.from('b'));
    expect(streams[0].write).toHaveBeenCalledTimes(1);
    session.destroy();
  });

  it('reuses one SpeechClient across streams and closes it on module destroy', async () => {
    service.createStream('en-IN');
    service.createStream('hi-IN');
    expect(mockSpeechClientCtor).toHaveBeenCalledTimes(1);
    expect(mockStreamingRecognize).toHaveBeenCalledTimes(2);

    await service.onModuleDestroy();
    expect(mockClose).toHaveBeenCalledTimes(1);

    // A second destroy is a no-op.
    await service.onModuleDestroy();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});
