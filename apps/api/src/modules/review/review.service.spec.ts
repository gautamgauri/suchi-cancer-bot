import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ReviewService } from './review.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewContext } from './review-checks';

describe('ReviewService', () => {
  let service: ReviewService;
  let prisma: any;

  const mockPrisma = {
    reviewRecord: {
      create: jest.fn().mockResolvedValue({ id: 'rr-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _avg: { reviewLatencyMs: 0 }, _max: { reviewLatencyMs: 0 } }),
      update: jest.fn().mockResolvedValue({}),
    },
    reviewPolicy: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
  };

  function createService(mode: string) {
    return Test.createTestingModule({
      providers: [
        ReviewService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => (key === 'REVIEW_COPILOT_MODE' ? mode : undefined) },
        },
      ],
    }).compile();
  }

  function makeCtx(overrides: Partial<ReviewContext> = {}): ReviewContext {
    return {
      responseText: 'General information about staying healthy.',
      userText: 'How can I stay healthy?',
      citations: [],
      retrievedChunkIds: [],
      retrievedDocIds: [],
      ...overrides,
    };
  }

  describe('mode=off', () => {
    beforeEach(async () => {
      const module = await createService('off');
      service = module.get<ReviewService>(ReviewService);
      prisma = module.get<PrismaService>(PrismaService);
    });

    it('should return PASS immediately with 0 latency', async () => {
      const result = await service.review(makeCtx());
      expect(result.verdict).toBe('PASS');
      expect(result.reviewLatencyMs).toBe(0);
    });

    it('persistRecord should be no-op', async () => {
      await service.persistRecord('msg-1', 'sess-1', {
        verdict: 'PASS',
        hardFailures: [],
        softFailures: [],
        ambiguousFlags: [],
        patchesApplied: [],
        repairedText: null,
        originalText: null,
        reviewLatencyMs: 0,
      });
      expect(mockPrisma.reviewRecord.create).not.toHaveBeenCalled();
    });
  });

  describe('mode=shadow', () => {
    beforeEach(async () => {
      const module = await createService('shadow');
      service = module.get<ReviewService>(ReviewService);
      jest.clearAllMocks();
    });

    it('should detect hard failures but return PASS (shadow)', async () => {
      const ctx = makeCtx({
        responseText: 'You definitely have cancer. Treatment is needed.',
      });
      const result = await service.review(ctx);
      expect(result.verdict).toBe('PASS'); // shadow mode never blocks
      expect(result.repairedText).toBeNull();
    });

    it('should run all checks', async () => {
      const ctx = makeCtx({
        responseText: 'Chemotherapy causes nausea.',
      });
      const result = await service.review(ctx);
      expect(result.verdict).toBe('PASS');
      expect(result.reviewLatencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('mode=active', () => {
    beforeEach(async () => {
      const module = await createService('active');
      service = module.get<ReviewService>(ReviewService);
      jest.clearAllMocks();
    });

    it('should block on hard failure (diagnosis language)', async () => {
      const ctx = makeCtx({
        responseText: 'You definitely have cancer.',
      });
      const result = await service.review(ctx);
      expect(result.verdict).toBe('BLOCKED');
      expect(result.hardFailures.length).toBeGreaterThan(0);
      expect(result.hardFailures[0].id).toBe('HF-2');
    });

    it('should block on dosing prescription', async () => {
      const ctx = makeCtx({
        responseText: 'Take 500mg of this medication twice a day.',
      });
      const result = await service.review(ctx);
      expect(result.verdict).toBe('BLOCKED');
      expect(result.hardFailures.some(f => f.id === 'HF-3')).toBe(true);
    });

    it('should block on fabricated citation', async () => {
      const ctx = makeCtx({
        responseText: 'Cancer screening is important [citation:fake_doc:fake_chunk].',
        retrievedChunkIds: ['real_chunk'],
        retrievedDocIds: ['real_doc'],
      });
      const result = await service.review(ctx);
      expect(result.verdict).toBe('BLOCKED');
      expect(result.hardFailures.some(f => f.id === 'HF-4')).toBe(true);
    });

    it('should repair missing disclaimer (SF-1)', async () => {
      const ctx = makeCtx({
        responseText: 'Chemotherapy can cause nausea and fatigue.',
      });
      const result = await service.review(ctx);
      // HF-1 will also fire (ungrounded medical claim with no citations)
      // so it will be BLOCKED, not REPAIRED
      expect(result.verdict).toBe('BLOCKED');
    });

    it('should repair missing disclaimer when citations present', async () => {
      const ctx = makeCtx({
        responseText: 'Chemotherapy can cause nausea [citation:doc1:chunk1].',
        citations: [{ docId: 'doc1', chunkId: 'chunk1', position: 0, citationText: 'nausea' }],
        retrievedChunkIds: ['chunk1'],
        retrievedDocIds: ['doc1'],
      });
      const result = await service.review(ctx);
      expect(result.verdict).toBe('REPAIRED');
      expect(result.repairedText).toContain('consult with your healthcare provider');
    });

    it('should pass clean responses', async () => {
      const ctx = makeCtx({
        responseText: 'I recommend speaking with your oncologist about your concerns.',
      });
      const result = await service.review(ctx);
      expect(result.verdict).toBe('PASS');
      expect(result.hardFailures).toHaveLength(0);
      expect(result.softFailures).toHaveLength(0);
    });

    it('should flag implicit diagnosis (AF-6)', async () => {
      const ctx = makeCtx({
        responseText: 'Your symptoms are consistent with cancer. Please consult your doctor. [citation:doc1:chunk1]',
        citations: [{ docId: 'doc1', chunkId: 'chunk1', position: 0, citationText: 'symptoms' }],
        retrievedChunkIds: ['chunk1'],
        retrievedDocIds: ['doc1'],
      });
      const result = await service.review(ctx);
      expect(result.verdict).toBe('FLAGGED');
      expect(result.ambiguousFlags.some(f => f.id === 'AF-6')).toBe(true);
    });
  });

  describe('buildBlockedFallback', () => {
    beforeEach(async () => {
      const module = await createService('active');
      service = module.get<ReviewService>(ReviewService);
    });

    it('should return safe fallback text', () => {
      const fallback = service.buildBlockedFallback([
        { id: 'HF-2', type: 'diagnosis_language', detail: 'test' },
      ]);
      expect(fallback).toContain('healthcare provider');
      expect(fallback).toContain('cancer.gov');
    });
  });
});
