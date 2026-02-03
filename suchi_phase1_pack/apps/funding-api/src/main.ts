import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { requestIdMiddleware } from "./common/request-id.middleware";
import { logStructured } from "./common/structured-logger";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  app.use(helmet());
  app.use(requestIdMiddleware);
  // Exclude root-level health endpoints from /v1 prefix
  // Note: /healthz is intercepted by Cloud Run GFE, so we use /live instead
  app.setGlobalPrefix("v1", { exclude: ["live", "ready"] });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);

  const gitSha = process.env.GIT_SHA || process.env.BUILD_ID || "dev";
  logStructured.log("Funding API started", {
    context: "bootstrap",
    port,
    path: "/v1",
    gitSha,
    env: process.env.NODE_ENV || "development",
    healthEndpoints: ["/live (liveness)", "/ready (readiness)", "/v1/health", "/v1/version"],
  });
}
bootstrap();
// trigger Tue Feb  3 20:34:34 UTC 2026
