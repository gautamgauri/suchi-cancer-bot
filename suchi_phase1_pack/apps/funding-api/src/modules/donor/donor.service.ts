import { Injectable } from "@nestjs/common";
import { FundingLlmService, DonorProfileResult } from "../core_ai/funding-llm.service";
import { GenerateProfileDto } from "./donor.dto";

@Injectable()
export class DonorService {
  constructor(private readonly llm: FundingLlmService) {}

  async generateProfile(dto: GenerateProfileDto): Promise<DonorProfileResult> {
    const chunks = dto.chunks?.map((c) => ({ content: c.content, title: c.title, url: c.url }));
    return this.llm.generateDonorProfile({
      orgName: dto.orgName,
      urls: dto.urls,
      notes: dto.notes,
      chunks,
    });
  }
}
