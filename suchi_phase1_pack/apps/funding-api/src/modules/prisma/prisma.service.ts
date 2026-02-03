import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private connected = false;
  private connecting = false;

  async onModuleInit() {
    // Do NOT block service startup on DB connectivity.
    // Kick off a background connection attempt with retries.
    this.connectInBackground().catch((e) => {
      this.logger.error('Unexpected error in connectInBackground()', e);
    });
  }

  async onModuleDestroy() {
    await this.$disconnect().catch(() => undefined);
  }

  isConnected() {
    return this.connected;
  }

  private async connectInBackground() {
    if (this.connecting) return;
    this.connecting = true;

    const maxAttempts = Number(process.env.PRISMA_CONNECT_MAX_ATTEMPTS ?? 30);
    const baseDelayMs = Number(process.env.PRISMA_CONNECT_BASE_DELAY_MS ?? 1000);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.$connect();
        this.connected = true;
        this.logger.log(`Prisma connected (attempt ${attempt}/${maxAttempts})`);
        this.connecting = false;
        return;
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        this.logger.warn(`Prisma connect failed (attempt ${attempt}/${maxAttempts}): ${msg}`);

        // Exponential-ish backoff with cap
        const delay = Math.min(baseDelayMs * attempt, 10_000);
        await sleep(delay);
      }
    }

    // Give up, but do not crash the server.
    this.logger.error(`Prisma failed to connect after ${maxAttempts} attempts. Service will continue in degraded mode.`);
    this.connecting = false;
  }
}
