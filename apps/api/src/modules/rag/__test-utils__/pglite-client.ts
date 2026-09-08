import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as path from "path";
import * as readline from "readline";

/**
 * Client for the out-of-process Postgres used by kb-fts.spec.ts.
 * See pglite-server.js for why the engine cannot run inside Jest's VM.
 */
export class PgliteSqlError extends Error {
  /** Postgres SQLSTATE, e.g. 42703 (undefined_column). */
  readonly code: string | null;

  constructor(message: string, code: string | null) {
    super(message);
    this.name = "PgliteSqlError";
    this.code = code;
  }
}

interface Pending {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

export class PgliteProcess {
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private child: ChildProcessWithoutNullStreams;

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      if (!line.trim()) return;
      const response = JSON.parse(line);
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.error) {
        pending.reject(new PgliteSqlError(response.error.message, response.error.code ?? null));
      } else {
        pending.resolve(response);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) process.stderr.write(`[pglite] ${text}\n`);
    });
  }

  static start(): PgliteProcess {
    const child = spawn(process.execPath, [path.join(__dirname, "pglite-server.js")], {
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
    return new PgliteProcess(child);
  }

  private request(payload: Record<string, unknown>): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ id, ...payload }) + "\n");
    });
  }

  async createDatabase(): Promise<PgliteDatabase> {
    const { handle } = await this.request({ op: "create" });
    return new PgliteDatabase(this, handle);
  }

  /** @internal */
  exec(handle: number, sql: string): Promise<void> {
    return this.request({ op: "exec", handle, sql });
  }

  /** @internal */
  async query<T>(handle: number, sql: string, params: unknown[] = []): Promise<T[]> {
    const { rows } = await this.request({ op: "query", handle, sql, params });
    return rows as T[];
  }

  /** @internal */
  close(handle: number): Promise<void> {
    return this.request({ op: "close", handle });
  }

  async stop(): Promise<void> {
    try {
      await this.request({ op: "shutdown" });
    } catch {
      /* the child exits as it answers; a lost reply is fine */
    }
    this.child.kill();
  }
}

export class PgliteDatabase {
  constructor(private readonly proc: PgliteProcess, private readonly handle: number) {}

  exec(sql: string): Promise<void> {
    return this.proc.exec(this.handle, sql);
  }

  query<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.proc.query<T>(this.handle, sql, params);
  }

  close(): Promise<void> {
    return this.proc.close(this.handle);
  }

  /**
   * A PrismaService stand-in that sends the service's real SQL to this real
   * database. Only `$queryRawUnsafe` is implemented — that is the single entry
   * point the lexical arm and the FTS probe use.
   *
   * Fidelity note: rows arrive as JSON, so `timestamp` columns come back as ISO
   * strings rather than the `Date` objects Prisma would hydrate. No assertion in
   * kb-fts.spec.ts depends on that, and the lexical arm passes those fields
   * straight through.
   */
  asPrisma(): any {
    return {
      $queryRawUnsafe: (sql: string, ...params: unknown[]) => this.query(sql, params),
      $queryRaw: () => {
        throw new Error("unexpected tagged-template query — the FTS path must use $queryRawUnsafe");
      },
    };
  }
}
