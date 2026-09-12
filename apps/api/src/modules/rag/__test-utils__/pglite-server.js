/* eslint-disable */
/**
 * Out-of-process Postgres for tests (see kb-fts.spec.ts).
 *
 * PGlite is a real Postgres compiled to WebAssembly, but its emscripten glue uses
 * `import()`, which Jest's CJS VM cannot service without `--experimental-vm-modules`.
 * Rather than change how the whole suite is invoked (`npx jest` / `npm run test:ci`),
 * the engine runs in a plain Node child process and speaks newline-delimited JSON
 * over stdio: one request per line, one response per line, matched by `id`.
 *
 * Protocol (request -> response):
 *   {id, op:"create"}                  -> {id, handle}
 *   {id, op:"exec",  handle, sql}      -> {id, ok:true}
 *   {id, op:"query", handle, sql, params} -> {id, rows}
 *   {id, op:"close", handle}           -> {id, ok:true}
 *   any failure                        -> {id, error:{message, code}}   (code = SQLSTATE)
 *
 * Requests are executed strictly in arrival order so DDL replay stays deterministic.
 */
const readline = require("readline");
const { PGlite } = require("@electric-sql/pglite");

const databases = new Map();
let nextHandle = 1;
let chain = Promise.resolve();

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

function dbFor(handle) {
  const db = databases.get(handle);
  if (!db) throw new Error(`unknown database handle: ${handle}`);
  return db;
}

async function handle(request) {
  switch (request.op) {
    case "create": {
      const db = await PGlite.create();
      const id = nextHandle++;
      databases.set(id, db);
      return { handle: id };
    }
    case "exec":
      await dbFor(request.handle).exec(request.sql);
      return { ok: true };
    case "query": {
      const result = await dbFor(request.handle).query(request.sql, request.params || []);
      return { rows: result.rows };
    }
    case "close": {
      const db = databases.get(request.handle);
      if (db) {
        databases.delete(request.handle);
        await db.close();
      }
      return { ok: true };
    }
    case "shutdown":
      for (const db of databases.values()) {
        try {
          await db.close();
        } catch {
          /* ignore */
        }
      }
      send({ id: request.id, ok: true });
      process.exit(0);
      return { ok: true };
    default:
      throw new Error(`unknown op: ${request.op}`);
  }
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  const request = JSON.parse(line);
  chain = chain.then(async () => {
    try {
      const result = await handle(request);
      send({ id: request.id, ...result });
    } catch (error) {
      send({
        id: request.id,
        error: {
          message: String((error && error.message) || error),
          // SQLSTATE, when Postgres gave us one — the test asserts on it.
          code: (error && error.code) || null,
        },
      });
    }
  });
});
