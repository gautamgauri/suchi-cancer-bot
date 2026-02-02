import { Injectable } from "@nestjs/common";

@Injectable()
export class HealthService {
  check() {
    return { ok: true };
  }

  getVersion() {
    const gitSha = process.env.GIT_SHA || process.env.BUILD_ID || "dev";
    return { service: "funding-api", gitSha };
  }
}
