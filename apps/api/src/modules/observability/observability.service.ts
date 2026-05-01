import { Injectable, Logger, OnModuleInit, OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

type TraceHandle = { id: string; _trace: any } | null;
type SpanHandle = { _span: any } | null;
type GenerationHandle = { _gen: any } | null;

@Injectable()
export class ObservabilityService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ObservabilityService.name);
  private client: any = null;
  private enabled = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    this.enabled = this.configService.get<boolean>("LANGFUSE_ENABLED") ?? false;
    if (!this.enabled) return;

    const publicKey = this.configService.get<string>("LANGFUSE_PUBLIC_KEY");
    const secretKey = this.configService.get<string>("LANGFUSE_SECRET_KEY");
    if (!publicKey || !secretKey) {
      this.logger.warn("LANGFUSE_ENABLED=true but keys missing — observability disabled");
      this.enabled = false;
      return;
    }

    try {
      const { Langfuse } = await import("langfuse");
      this.client = new Langfuse({
        publicKey,
        secretKey,
        baseUrl: this.configService.get<string>("LANGFUSE_HOST") ?? "https://cloud.langfuse.com",
        flushAt: 20,
        flushInterval: 10000,
      });
      this.logger.log("Langfuse observability initialized");
    } catch (err: any) {
      this.logger.warn(`Langfuse init failed: ${err.message} — observability disabled`);
      this.enabled = false;
    }
  }

  async onApplicationShutdown() {
    if (this.client) {
      try {
        await this.client.shutdownAsync();
      } catch (_) {}
    }
  }

  startTrace(name: string, input: Record<string, any>, metadata?: Record<string, any>): TraceHandle {
    if (!this.enabled || !this.client) return null;
    try {
      const trace = this.client.trace({ name, input, metadata });
      return { id: trace.id, _trace: trace };
    } catch (err: any) {
      this.logger.warn(`startTrace failed: ${err.message}`);
      return null;
    }
  }

  startSpan(trace: TraceHandle, name: string, input?: Record<string, any>): SpanHandle {
    if (!trace) return null;
    try {
      const span = trace._trace.span({ name, input });
      return { _span: span };
    } catch (err: any) {
      this.logger.warn(`startSpan failed: ${err.message}`);
      return null;
    }
  }

  endSpan(span: SpanHandle, output?: Record<string, any>) {
    if (!span) return;
    try {
      span._span.end({ output });
    } catch (err: any) {
      this.logger.warn(`endSpan failed: ${err.message}`);
    }
  }

  startGeneration(trace: TraceHandle, name: string, input: string, model: string, metadata?: Record<string, any>): GenerationHandle {
    if (!trace) return null;
    try {
      const gen = trace._trace.generation({ name, input, model, metadata });
      return { _gen: gen };
    } catch (err: any) {
      this.logger.warn(`startGeneration failed: ${err.message}`);
      return null;
    }
  }

  endGeneration(gen: GenerationHandle, output: string, usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }) {
    if (!gen) return;
    try {
      gen._gen.end({ output, usage });
    } catch (err: any) {
      this.logger.warn(`endGeneration failed: ${err.message}`);
    }
  }

  /** Create a generation span using a raw traceId string (no trace object needed). */
  startGenerationById(traceId: string | undefined, name: string, input: string, model: string, metadata?: Record<string, any>): GenerationHandle {
    if (!this.enabled || !this.client || !traceId) return null;
    try {
      const gen = this.client.generation({ traceId, name, input, model, metadata });
      return { _gen: gen };
    } catch (err: any) {
      this.logger.warn(`startGenerationById failed: ${err.message}`);
      return null;
    }
  }

  finalizeTrace(trace: TraceHandle, output?: Record<string, any>) {
    if (!trace) return;
    try {
      trace._trace.update({ output });
    } catch (err: any) {
      this.logger.warn(`finalizeTrace failed: ${err.message}`);
    }
  }
}
