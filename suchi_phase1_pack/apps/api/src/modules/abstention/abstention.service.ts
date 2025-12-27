import { Injectable } from "@nestjs/common";
import { AbstentionReason } from "../evidence/evidence-gate.service";
import { QueryType } from "../../config/trusted-sources.config";

@Injectable()
export class AbstentionService {
  /**
   * Generate appropriate abstention message when evidence is insufficient
   */
  generateAbstentionMessage(reason: AbstentionReason, queryType: QueryType): string {
    const baseMessage = "I don't have enough reliable information to answer this question.";

    switch (reason) {
      case "no_evidence":
        return `${baseMessage} This topic may not be covered in my knowledge base, or your question might need to be rephrased.\n\nI recommend:\n- Consulting with a qualified healthcare professional\n- Checking with your oncology team if you're already in treatment\n- Contacting a cancer helpline for immediate support`;

      case "insufficient_passages":
      case "insufficient_sources":
        return `${baseMessage} I found some information, but not enough to provide a comprehensive and reliable answer.\n\nFor ${this.getQueryTypeDescription(queryType)} questions, I need multiple sources to ensure accuracy.\n\nNext steps:\n- Consult with your healthcare provider who can access comprehensive medical resources\n- Share your specific situation with your oncology team`;

      case "untrusted_sources":
        return `${baseMessage} The information I found isn't from sources I'm authorized to use.\n\nI only provide answers based on trusted medical sources (NCI, WHO, recognized medical organizations).\n\nPlease:\n- Consult with a qualified healthcare professional\n- Check official medical websites for this information`;

      case "outdated_content":
        return `${baseMessage} The information I have may be outdated, and medical guidelines for ${this.getQueryTypeDescription(queryType)} change over time.\n\nI recommend:\n- Consulting with your healthcare provider for the most current information\n- Checking with your oncology team for the latest guidelines`;

      case "conflicting_evidence":
        return `${baseMessage} I found information from multiple sources that present different perspectives. Medical information can vary based on specific situations and guidelines.\n\nSince this requires careful interpretation:\n- Please discuss this with your healthcare provider\n- Your doctor can help you understand which information applies to your specific case\n- Consider getting a second opinion from another qualified oncologist if you're uncertain`;

      case "citation_validation_failed":
        return `${baseMessage} I generated a response, but I couldn't properly verify all the sources. To ensure accuracy, I'd rather provide you with guidance on next steps.\n\nPlease:\n- Consult with a qualified healthcare professional\n- Use official medical resources for detailed information\n- Prepare questions to discuss with your oncology team`;

      default:
        return `${baseMessage}\n\nNext steps:\n- Consult with a qualified healthcare professional\n- Check with your oncology team\n- Contact a cancer helpline for support`;
    }
  }

  private getQueryTypeDescription(queryType: QueryType): string {
    const descriptions: Record<QueryType, string> = {
      treatment: "treatment",
      sideEffects: "side effects",
      prevention: "prevention",
      screening: "screening",
      caregiver: "caregiver support",
      navigation: "navigation",
      general: "general cancer information"
    };
    return descriptions[queryType] || "cancer-related";
  }
}

