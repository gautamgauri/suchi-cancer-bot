import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Storage } from "@google-cloud/storage";

@Injectable()
export class GcsStorageService {
  private readonly logger = new Logger(GcsStorageService.name);
  private readonly storage: Storage;
  private readonly bucketName: string;
  private readonly signedUrlExpiryMin: number;

  constructor(private readonly config: ConfigService) {
    this.storage = new Storage();
    this.bucketName = this.config.get<string>("GCS_BUCKET_TTS") || "suchi-tts-audio";
    this.signedUrlExpiryMin = this.config.get<number>("GCS_SIGNED_URL_EXPIRY_MIN") || 60;
  }

  async uploadAndSign(audioBuffer: Buffer, sessionId: string, encoding = "mp3"): Promise<{ signedUrl: string }> {
    const fileName = `tts/${sessionId}/${Date.now()}.${encoding}`;
    const file = this.storage.bucket(this.bucketName).file(fileName);

    await file.save(audioBuffer, {
      contentType: encoding === "mp3" ? "audio/mpeg" : "audio/ogg",
      metadata: { cacheControl: "public, max-age=3600" },
    });

    const [signedUrl] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + this.signedUrlExpiryMin * 60 * 1000,
    });

    this.logger.log(`Uploaded TTS audio: gs://${this.bucketName}/${fileName}`);
    return { signedUrl };
  }
}
