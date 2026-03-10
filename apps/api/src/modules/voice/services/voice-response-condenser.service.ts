import { Injectable } from "@nestjs/common";

const VOICE_DISCLAIMER =
  " Please consult your doctor for personal medical advice.";

@Injectable()
export class VoiceResponseCondenser {
  private readonly MAX_SENTENCES = 6;

  condense(responseText: string): { plainText: string; ssml: string } {
    let text = responseText;

    // Strip the disclaimer-engine block (--- + italic disclaimer)
    text = text.replace(/\n+---\n\*[^*]+\*\s*$/s, "");

    // Strip citation markers
    text = text.replace(/\[citation:[^\]]+\]/g, "");

    // Strip markdown bold/italic
    text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
    text = text.replace(/\*([^*]+)\*/g, "$1");

    // Strip markdown headers
    text = text.replace(/^#{1,6}\s+/gm, "");

    // Strip bullet points
    text = text.replace(/^[-*]\s+/gm, "");

    // Convert numbered lists to speakable form
    text = text.replace(/^(\d+)[.)]\s+/gm, (_, num) => `Step ${num}, `);

    // Strip note/disclaimer lines
    text = text.replace(/\*?\*?Important:?\*?\*?[^\n]+\n*/gi, "");
    text = text.replace(/\*?\*?Note:?\*?\*?[^\n]+\n*/gi, "");
    text = text.replace(/\*?\*?Sources?:?\*?\*?[^\n]*/gi, "");

    // Collapse whitespace
    text = text.replace(/\n{2,}/g, " ").replace(/\s+/g, " ").trim();

    // Split into sentences and truncate
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const truncated = sentences.slice(0, this.MAX_SENTENCES).join(" ").trim();

    // Append short voice-friendly disclaimer
    const withDisclaimer = truncated + VOICE_DISCLAIMER;

    return { plainText: withDisclaimer, ssml: this.toSsml(withDisclaimer) };
  }

  private toSsml(text: string): string {
    let ssml = text.replace(/([.!?])\s+/g, '$1<break time="400ms"/> ');

    // Emphasize emergency terms
    ssml = ssml.replace(
      /(emergency|ambulance|112|108|immediately|turant|tatkal)/gi,
      '<emphasis level="strong">$1</emphasis>',
    );

    return `<speak>${ssml}</speak>`;
  }
}
