import { Injectable, Logger, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Storage } from "@google-cloud/storage";
import { SocialPostService } from "./social-post.service";

const GCS_BUCKET  = process.env.QUEUE_GCS_BUCKET;
const GCS_PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? "gen-lang-client-0202543132";
const QUEUE_OBJECT = "content-queue.json";

interface ArticleEntry {
  slug: string;
  title: string;
  contentType: string;
  status: string;
  createdAt: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  approvalToken?: string;
}

interface ContentQueue {
  articles: ArticleEntry[];
}

@Injectable()
export class ContentApproveService {
  private readonly logger = new Logger(ContentApproveService.name);

  constructor(private readonly social: SocialPostService) {}

  private verifyHmac(slug: string, token: string): void {
    const secret = process.env.CONTENT_APPROVAL_SECRET || "suchi-content-dev-secret";
    const expected = createHmac("sha256", secret).update(slug).digest("hex");
    const tokenBuf    = Buffer.from(token, "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (tokenBuf.length !== expectedBuf.length || !timingSafeEqual(tokenBuf, expectedBuf)) {
      throw new UnauthorizedException("Invalid approval token");
    }
  }

  private async readQueue(): Promise<ContentQueue> {
    if (!GCS_BUCKET) throw new Error("QUEUE_GCS_BUCKET not configured");
    const storage = new Storage({ projectId: GCS_PROJECT });
    const [buf] = await storage.bucket(GCS_BUCKET).file(QUEUE_OBJECT).download() as [Buffer];
    return JSON.parse(buf.toString("utf-8")) as ContentQueue;
  }

  private async writeQueue(queue: ContentQueue): Promise<void> {
    if (!GCS_BUCKET) return;
    const storage = new Storage({ projectId: GCS_PROJECT });
    await storage.bucket(GCS_BUCKET).file(QUEUE_OBJECT).save(
      JSON.stringify(queue, null, 2) + "\n",
      { contentType: "application/json" },
    );
  }

  async approveArticle(slug: string, token: string): Promise<{ title: string }> {
    this.verifyHmac(slug, token);
    const queue = await this.readQueue();
    const entry = queue.articles.find((a) => a.slug === slug);
    if (!entry) throw new NotFoundException(`Article "${slug}" not found`);

    if (entry.status === "approved") {
      this.logger.log(`Article "${slug}" already approved`);
      return { title: entry.title };
    }

    entry.status = "approved";
    entry.approvedAt = new Date().toISOString();
    entry.approvedBy = "email_approval";
    await this.writeQueue(queue);

    this.logger.log(`Article "${slug}" approved — triggering social distribution`);

    // Fire-and-forget: generate social drafts and send approval email
    this.social.generateAndQueue(slug, entry.title, entry.contentType).catch((err) => {
      this.logger.error(`Social queue generation failed for "${slug}"`, err);
    });

    return { title: entry.title };
  }

  async rejectArticle(slug: string, token: string): Promise<{ title: string }> {
    this.verifyHmac(slug, token);
    const queue = await this.readQueue();
    const entry = queue.articles.find((a) => a.slug === slug);
    if (!entry) throw new NotFoundException(`Article "${slug}" not found`);

    entry.status = "rejected";
    entry.rejectedAt = new Date().toISOString();
    await this.writeQueue(queue);

    this.logger.log(`Article "${slug}" rejected`);
    return { title: entry.title };
  }
}
