import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import {
  fundingApiService,
  type EmailTemplate,
  type PipelineEntry,
} from "../../../services/fundingApi";
import { DraftViewer } from "../DraftViewer";

const EMAIL_TEMPLATES: EmailTemplate[] = [
  "intro",
  "follow_up",
  "meeting_request",
  "proposal_nudge",
  "thank_you",
];

const MISSING_EVIDENCE = "MISSING_EVIDENCE";

interface DraftsTabProps {
  entryId: string;
  entry?: PipelineEntry | null;
  compact?: boolean;
}

export function DraftsTab({ entryId, entry, compact = false }: DraftsTabProps) {
  const { t } = useTranslation("funding");
  const queryClient = useQueryClient();
  const p = compact ? "p-2" : "p-4";

  // Draft Email state
  const [emailTemplate, setEmailTemplate] = useState<EmailTemplate>("intro");
  const [emailContext, setEmailContext] = useState("");
  const [donorSnippet, setDonorSnippet] = useState("");
  const [emailDraft, setEmailDraft] = useState<string | null>(null);

  // Need Statement Refine state
  const [nsContext, setNsContext] = useState("");
  const [nsUserMessage, setNsUserMessage] = useState("");
  const [nsResult, setNsResult] = useState<{
    draft: string;
    evaluation: { score: number; weaknesses: string[] };
    refined: string;
  } | null>(null);
  const [missingEvidenceText, setMissingEvidenceText] = useState<string | null>(null);

  const draftEmailMutation = useMutation({
    mutationFn: () =>
      fundingApiService.draftEmail({
        template: emailTemplate,
        context: emailContext,
        pipelineContext: entry
          ? {
              orgName: entry.orgName,
              contactName: entry.contactName,
              stage: entry.stage,
              nextAction: entry.nextAction,
              notes: entry.notes,
            }
          : undefined,
        donorProfileSnippet: donorSnippet.trim() || undefined,
      }),
    onSuccess: (data) => {
      setEmailDraft(data.text);
      toast.success(t("common:saved", { ns: "common" }));
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to draft email");
    },
  });

  const refineMutation = useMutation({
    mutationFn: () =>
      fundingApiService.draftNeedStatementRefine({
        context: nsContext,
        userMessage: nsUserMessage,
        chunks: [],
      }),
    onSuccess: (data) => {
      const hasMissing =
        data.draft?.includes(MISSING_EVIDENCE) || data.refined?.includes(MISSING_EVIDENCE);
      if (hasMissing) {
        setMissingEvidenceText(data.draft || data.refined || null);
        setNsResult(null);
      } else {
        setMissingEvidenceText(null);
        setNsResult({
          draft: data.draft,
          evaluation: data.evaluation,
          refined: data.refined,
        });
      }
      toast.success(t("common:saved", { ns: "common" }));
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to refine need statement");
    },
  });

  const copyChecklist = () => {
    if (missingEvidenceText) {
      navigator.clipboard.writeText(missingEvidenceText);
      toast.success(t("common:copy", { ns: "common" }));
    }
  };

  const logEmailAsActivity = () => {
    if (!emailDraft) return;
    fundingApiService
      .logActivity({
        orgId: entryId,
        type: "note",
        notes: emailDraft.slice(0, 500),
      })
      .then(() => {
        toast.success(t("common:saved", { ns: "common" }));
        queryClient.invalidateQueries({ queryKey: ["pipeline-entry-activities", entryId] });
        queryClient.invalidateQueries({ queryKey: ["pipeline"] });
      })
      .catch((err: Error) => toast.error(err.message || "Failed to log activity"));
  };

  const logRefinedAsActivity = () => {
    if (!nsResult?.refined) return;
    fundingApiService
      .logActivity({
        orgId: entryId,
        type: "note",
        notes: nsResult.refined.slice(0, 500),
      })
      .then(() => {
        toast.success(t("common:saved", { ns: "common" }));
        queryClient.invalidateQueries({ queryKey: ["pipeline-entry-activities", entryId] });
        queryClient.invalidateQueries({ queryKey: ["pipeline"] });
      })
      .catch((err: Error) => toast.error(err.message || "Failed to log activity"));
  };

  const downloadTxt = (text: string, filename: string) => {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("drafts.downloadTxt"));
  };

  return (
    <div className={p}>
      {/* Draft Email card */}
      <section
        className="mb-6 rounded-lg border border-border bg-card p-4"
        aria-labelledby="draft-email-heading"
      >
        <h2 id="draft-email-heading" className="text-base font-semibold text-foreground">
          {t("drafts.draftEmail")}
        </h2>
        <div className="mt-3 space-y-3">
          <div>
            <label
              htmlFor="draft-email-template"
              className="block text-sm font-medium text-foreground"
            >
              {t("drafts.template")}
            </label>
            <select
              id="draft-email-template"
              value={emailTemplate}
              onChange={(e) => setEmailTemplate(e.target.value as EmailTemplate)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              aria-describedby="draft-email-template-desc"
            >
              {EMAIL_TEMPLATES.map((tpl) => (
                <option key={tpl} value={tpl}>
                  {t(`drafts.templates.${tpl}`)}
                </option>
              ))}
            </select>
            <p id="draft-email-template-desc" className="sr-only">
              {t("drafts.template")}
            </p>
          </div>
          <div>
            <label htmlFor="draft-email-context" className="block text-sm font-medium text-foreground">
              {t("drafts.context")}
            </label>
            <textarea
              id="draft-email-context"
              value={emailContext}
              onChange={(e) => setEmailContext(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder={t("drafts.context")}
              aria-describedby="draft-email-context-desc"
            />
            <p id="draft-email-context-desc" className="sr-only">
              {t("drafts.context")}
            </p>
          </div>
          <div>
            <label
              htmlFor="draft-email-donor"
              className="block text-sm font-medium text-foreground"
            >
              {t("drafts.donorSnippet")}
            </label>
            <textarea
              id="draft-email-donor"
              value={donorSnippet}
              onChange={(e) => setDonorSnippet(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder={t("drafts.donorSnippet")}
              aria-describedby="draft-email-donor-desc"
            />
            <p id="draft-email-donor-desc" className="sr-only">
              {t("drafts.donorSnippet")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => draftEmailMutation.mutate()}
            disabled={draftEmailMutation.isPending || !emailContext.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label={t("drafts.generate")}
          >
            {draftEmailMutation.isPending ? t("common:loading", { ns: "common" }) : t("drafts.generate")}
          </button>
        </div>
        {emailDraft && (
          <div className="mt-4">
            <DraftViewer
              text={emailDraft}
              onCopy={() => {
                navigator.clipboard.writeText(emailDraft!);
                toast.success(t("common:copy", { ns: "common" }));
              }}
              onDownloadTxt={() => downloadTxt(emailDraft!, "draft-email.txt")}
              onLogAsActivity={logEmailAsActivity}
            />
          </div>
        )}
      </section>

      {/* Need Statement Refine card */}
      <section
        className="rounded-lg border border-border bg-card p-4"
        aria-labelledby="need-statement-heading"
      >
        <h2 id="need-statement-heading" className="text-base font-semibold text-foreground">
          {t("drafts.needStatementRefine")}
        </h2>
        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor="ns-context" className="block text-sm font-medium text-foreground">
              {t("drafts.context")}
            </label>
            <textarea
              id="ns-context"
              value={nsContext}
              onChange={(e) => setNsContext(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder={t("drafts.context")}
              aria-describedby="ns-context-desc"
            />
            <p id="ns-context-desc" className="sr-only">
              {t("drafts.context")}
            </p>
          </div>
          <div>
            <label htmlFor="ns-user-prompt" className="block text-sm font-medium text-foreground">
              {t("drafts.userPrompt")}
            </label>
            <textarea
              id="ns-user-prompt"
              value={nsUserMessage}
              onChange={(e) => setNsUserMessage(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder={t("drafts.userPrompt")}
              aria-describedby="ns-user-prompt-desc"
            />
            <p id="ns-user-prompt-desc" className="sr-only">
              {t("drafts.userPrompt")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => refineMutation.mutate()}
            disabled={refineMutation.isPending || !nsContext.trim() || !nsUserMessage.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label={t("drafts.generateRefine")}
          >
            {refineMutation.isPending
              ? t("common:loading", { ns: "common" })
              : t("drafts.generateRefine")}
          </button>
        </div>

        {missingEvidenceText && (
          <div
            className="mt-4 rounded-lg border-2 border-accent bg-accent/10 p-3"
            role="alert"
            aria-live="polite"
          >
            <p className="text-sm font-medium text-accent-foreground">
              {t("drafts.missingEvidence")}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{t("drafts.missingEvidenceDesc")}</p>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-background p-2 text-xs text-foreground">
              {missingEvidenceText}
            </pre>
            <button
              type="button"
              onClick={copyChecklist}
              className="mt-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label={t("drafts.copyChecklist")}
            >
              {t("drafts.copyChecklist")}
            </button>
          </div>
        )}

        {nsResult && (
          <div className="mt-4 space-y-4">
            <details className="rounded-lg border border-border bg-muted/30">
              <summary className="cursor-pointer p-3 text-sm font-medium text-foreground">
                {t("drafts.draft")}
              </summary>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words border-t border-border p-3 text-sm text-foreground">
                {nsResult.draft}
              </pre>
            </details>
            <details className="rounded-lg border border-border bg-muted/30">
              <summary className="cursor-pointer p-3 text-sm font-medium text-foreground">
                {t("drafts.evaluation")} (score: {nsResult.evaluation.score})
              </summary>
              <ul className="list-disc border-t border-border p-3 pl-5 text-sm text-foreground">
                {nsResult.evaluation.weaknesses.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
            <div>
              <p className="text-sm font-medium text-foreground">{t("drafts.refined")}</p>
              <DraftViewer
                text={nsResult.refined}
                onCopy={() => {
                  navigator.clipboard.writeText(nsResult!.refined);
                  toast.success(t("common:copy", { ns: "common" }));
                }}
                onLogAsActivity={logRefinedAsActivity}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
