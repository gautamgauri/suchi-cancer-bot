import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  app.use(helmet());
  app.setGlobalPrefix("v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  
  // Log DB schema version and target fingerprint at startup (operational visibility)
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    // Get migration status
    const migrations = await prisma.$queryRaw<Array<{ migration_name: string; applied_steps_count: number }>>`
      SELECT migration_name, applied_steps_count 
      FROM _prisma_migrations 
      ORDER BY finished_at DESC 
      LIMIT 1
    `;
    const latestMigration = migrations[0]?.migration_name || "unknown";
    const buildId = process.env.BUILD_ID || process.env.IMAGE_TAG || "local";
    
    // Get DB target fingerprint (safe - no credentials)
    const dbUrl = process.env.DATABASE_URL || "";
    let dbFingerprint = "unknown";
    try {
      const url = new URL(dbUrl);
      const dbName = url.pathname.split("/").filter(Boolean)[0] || "unknown";
      const instanceConn = process.env.INSTANCE_CONNECTION_NAME || 
                          (url.searchParams.get("host")?.replace("/cloudsql/", "") || "unknown");
      const env = process.env.NODE_ENV || "unknown";
      dbFingerprint = `db=${dbName},instance=${instanceConn.split("/").pop() || instanceConn},env=${env}`;
    } catch {
      // If URL parsing fails, just use a safe fallback
      dbFingerprint = "db=unknown,instance=unknown,env=" + (process.env.NODE_ENV || "unknown");
    }
    
    console.log(`[DB Schema] Latest migration: ${latestMigration}`);
    console.log(`[Build] Image tag: ${buildId}`);
    console.log(`[DB Target] ${dbFingerprint}`);
    await prisma.$disconnect();
  } catch (error: any) {
    console.warn(`[DB Schema] Could not read migration status: ${error.message}`);
  }
  
  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port);
  console.log(`Suchi API listening on http://localhost:${port}/v1`);
}
bootstrap();
