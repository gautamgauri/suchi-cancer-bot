import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GoogleSttV2Provider } from './google-stt-v2.provider';

// Mock SpeechClient
const mockRecognize = jest.fn();
jest.mock('@google-cloud/speech', () => ({
  SpeechClient: jest.fn().mockImplementation(() => ({
    recognize: mockRecognize,
  })),
}));

describe('GoogleSttV2Provider', () => {
  let provider: GoogleSttV2Provider;

  beforeEach(async () => {
    mockRecognize.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleSttV2Provider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'STT_MODEL') return 'latest_long';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    provider = module.get(GoogleSttV2Provider);
  });

  it('should transcribe audio with V2 phrase adaptation', async () => {
    mockRecognize.mockResolvedValue([
      {
        results: [
          {
            alternatives: [
              { transcript: 'I am from Muzaffarpur and have breast cancer', confidence: 0.92 },
            ],
            languageCode: 'en-IN',
          },
        ],
      },
    ]);

    const result = await provider.transcribe(Buffer.from('fake-audio'), 'hi-IN');

    expect(result.transcript).toBe('I am from Muzaffarpur and have breast cancer');
    expect(result.confidence).toBe(0.92);
    expect(result.languageCode).toBe('en-IN');

    // Verify V2 adaptation config was passed
    const callArgs = mockRecognize.mock.calls[0][0];
    expect(callArgs.config.adaptation).toBeDefined();
    expect(callArgs.config.adaptation.phraseSets).toHaveLength(1);
    expect(callArgs.config.adaptation.phraseSets[0].phrases.length).toBeGreaterThan(50);
    expect(callArgs.config.model).toBe('latest_long');
    expect(callArgs.config.alternativeLanguageCodes).toEqual(['en-IN']);
  });

  it('should use en-IN alternate language when primary is hi-IN', async () => {
    mockRecognize.mockResolvedValue([
      { results: [{ alternatives: [{ transcript: 'test', confidence: 0.8 }] }] },
    ]);

    await provider.transcribe(Buffer.from('audio'), 'hi-IN');

    const callArgs = mockRecognize.mock.calls[0][0];
    expect(callArgs.config.languageCode).toBe('hi-IN');
    expect(callArgs.config.alternativeLanguageCodes).toEqual(['en-IN']);
  });

  it('should use hi-IN alternate language when primary is en-IN', async () => {
    mockRecognize.mockResolvedValue([
      { results: [{ alternatives: [{ transcript: 'test', confidence: 0.8 }] }] },
    ]);

    await provider.transcribe(Buffer.from('audio'), 'en-IN');

    const callArgs = mockRecognize.mock.calls[0][0];
    expect(callArgs.config.languageCode).toBe('en-IN');
    expect(callArgs.config.alternativeLanguageCodes).toEqual(['hi-IN']);
  });

  it('should handle empty results gracefully', async () => {
    mockRecognize.mockResolvedValue([{ results: [] }]);

    const result = await provider.transcribe(Buffer.from('audio'));

    expect(result.transcript).toBe('');
    expect(result.confidence).toBe(0);
    expect(result.languageCode).toBe('hi-IN');
  });

  it('should handle null alternatives gracefully', async () => {
    mockRecognize.mockResolvedValue([
      { results: [{ alternatives: [] }] },
    ]);

    const result = await provider.transcribe(Buffer.from('audio'));

    expect(result.transcript).toBe('');
    expect(result.confidence).toBe(0);
  });

  it('should include phrase boost values', async () => {
    mockRecognize.mockResolvedValue([
      { results: [{ alternatives: [{ transcript: 'test', confidence: 0.9 }] }] },
    ]);

    await provider.transcribe(Buffer.from('audio'));

    const phrases = mockRecognize.mock.calls[0][0].config.adaptation.phraseSets[0].phrases;
    const muzaffarpurPhrase = phrases.find((p: any) => p.value === 'Muzaffarpur');
    expect(muzaffarpurPhrase).toBeDefined();
    expect(muzaffarpurPhrase.boost).toBe(15);
  });
});
