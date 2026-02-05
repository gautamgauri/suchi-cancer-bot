import { useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { fundingApiService, type PipelineEntry, type PipelineStage } from "../../../services/fundingApi";
import { CapabilityTagger } from "./CapabilityTagger";

const STAGE_OPTIONS: PipelineStage[] = ["RFP_received", "lead", "qualified", "proposal_sent", "won", "lost"];

interface OverviewTabProps {
  entry: PipelineEntry;
  compact?: boolean;
}

function getEditEntrySchema(orgNameRequiredMsg: string) {
  return z.object({
    orgName: z.string().min(1, orgNameRequiredMsg),
    contactName: z.string().optional(),
    contactEmail: z.string().email().optional().or(z.literal("")),
    stage: z.enum(["RFP_received", "lead", "qualified", "proposal_sent", "won", "lost"]),
    owner: z.string().optional(),
    nextAction: z.string().optional(),
    nextActionDate: z.string().optional(),
    probability: z.coerce.number().min(0).max(100).optional().nullable(),
    notes: z.string().optional(),
    geography: z.string().optional(),
    estimatedGrantSize: z.string().optional(),
    sectorTags: z.string().optional(),
  });
}
type EditEntryForm = z.infer<ReturnType<typeof getEditEntrySchema>>;

export function OverviewTab({ entry, compact = false }: OverviewTabProps) {
  const { t } = useTranslation(["funding", "common"]);
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const p = compact ? "p-2" : "p-4";
  const editEntrySchema = useMemo(
    () => getEditEntrySchema(t("funding:validation.orgNameRequired")),
    [t]
  );

  const updateMutation = useMutation({
    mutationFn: (data: EditEntryForm) => {
      const payload = {
        ...data,
        contactEmail: data.contactEmail || undefined,
        probability: data.probability ?? undefined,
        sectorTags: data.sectorTags ? data.sectorTags.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        version: entry.version ?? 1,
      };
      return fundingApiService.updateEntry(entry.id, payload);
    },
    onSuccess: () => {
      toast.success(t("common:saved"));
      queryClient.invalidateQueries({ queryKey: ["pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline-entry", entry.id] });
      setIsEditing(false);
    },
    onError: (err: Error) => {
      if (err.message.includes("version") || err.message.includes("conflict")) {
        toast.error(t("funding:errors.entryConflict"));
      } else {
        toast.error(err.message || t("funding:errors.saveFailed"));
      }
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<EditEntryForm>({
    resolver: zodResolver(editEntrySchema),
    defaultValues: {
      orgName: entry.orgName,
      contactName: entry.contactName ?? "",
      contactEmail: entry.contactEmail ?? "",
      stage: entry.stage,
      owner: entry.owner ?? "",
      nextAction: entry.nextAction ?? "",
      nextActionDate: entry.nextActionDate?.split("T")[0] ?? "",
      probability: entry.probability ?? null,
      notes: entry.notes ?? "",
      geography: entry.geography ?? "",
      estimatedGrantSize: entry.estimatedGrantSize ?? "",
      sectorTags: entry.sectorTags?.join(", ") ?? "",
    },
  });

  const copyNotes = () => {
    if (entry.notes) {
      navigator.clipboard.writeText(entry.notes);
      toast.success(t("common:copied", "Copied!"));
    }
  };

  const onSubmit = (data: EditEntryForm) => {
    updateMutation.mutate(data);
  };

  const handleCancel = () => {
    reset();
    setIsEditing(false);
  };

  if (!isEditing) {
    // Read-only view
    return (
      <div className={p}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">{t("funding:drawer.overview")}</h3>
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {t("common:edit", "Edit")}
          </button>
        </div>

        <dl className="space-y-3 text-sm">
          <Row label={t("funding:pipeline.orgName")} value={entry.orgName} />
          <Row label={t("funding:pipeline.stage")} value={entry.stage.replace(/_/g, " ")} />
          <Row label={t("funding:pipeline.contactName", "Contact")} value={entry.contactName ?? "—"} />
          <Row label={t("funding:pipeline.contactEmail", "Email")} value={entry.contactEmail ?? "—"} />
          <Row label={t("funding:pipeline.owner")} value={entry.owner ?? "—"} />
          <Row label={t("funding:pipeline.nextAction")} value={entry.nextAction ?? "—"} />
          <Row label={t("funding:pipeline.nextActionDate", "Next action date")} value={entry.nextActionDate?.split("T")[0] ?? "—"} />
          <Row label={t("funding:pipeline.lastActivity")} value={entry.lastContactDate?.split("T")[0] ?? "—"} />
          <Row label={t("funding:pipeline.priority")} value={entry.probability != null ? `${entry.probability}%` : "—"} />
          <Row label={t("funding:pipeline.geography", "Geography")} value={entry.geography ?? "—"} />
          <Row label={t("funding:pipeline.estimatedGrantSize", "Grant size")} value={entry.estimatedGrantSize ?? "—"} />
          <Row label={t("funding:pipeline.sectorTags", "Sectors")} value={entry.sectorTags?.join(", ") || "—"} />
        </dl>

        <div className="mt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">{t("funding:pipeline.notes", "Notes")}</span>
            <button
              type="button"
              onClick={copyNotes}
              disabled={!entry.notes}
              className="rounded bg-muted px-2 py-1 text-xs text-foreground hover:bg-muted/80 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label={t("funding:drawer.copyNotes")}
            >
              {t("common:copy")}
            </button>
          </div>
          <div className="mt-2 rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            {entry.notes || "—"}
          </div>
        </div>

        <div className="mt-4 border-t border-border pt-4">
          <CapabilityTagger entryId={entry.id} compact={compact} />
        </div>
      </div>
    );
  }

  // Edit mode
  return (
    <form onSubmit={handleSubmit(onSubmit)} className={p}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground">{t("funding:drawer.editEntry", "Edit Entry")}</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {t("common:cancel")}
          </button>
          <button
            type="submit"
            disabled={!isDirty || updateMutation.isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {updateMutation.isPending ? t("common:loading") : t("common:save")}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <Field label={t("funding:pipeline.orgName") + " *"} error={errors.orgName?.message}>
          <input type="text" {...register("orgName")} className="input-field" />
        </Field>

        <Field label={t("funding:pipeline.stage")}>
          <select {...register("stage")} className="input-field">
            {STAGE_OPTIONS.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
            ))}
          </select>
        </Field>

        <Field label={t("funding:pipeline.contactName", "Contact Name")}>
          <input type="text" {...register("contactName")} className="input-field" />
        </Field>

        <Field label={t("funding:pipeline.contactEmail", "Contact Email")} error={errors.contactEmail?.message}>
          <input type="email" {...register("contactEmail")} className="input-field" />
        </Field>

        <Field label={t("funding:pipeline.owner")}>
          <input type="text" {...register("owner")} className="input-field" />
        </Field>

        <Field label={t("funding:pipeline.probability", "Probability")} error={errors.probability?.message}>
          <input type="number" min={0} max={100} {...register("probability")} className="input-field" placeholder={t("funding:pipeline.placeholders.probability")} />
        </Field>

        <Field label={t("funding:pipeline.geography", "Geography")}>
          <input type="text" {...register("geography")} className="input-field" />
        </Field>

        <Field label={t("funding:pipeline.estimatedGrantSize", "Estimated Grant Size")}>
          <input type="text" {...register("estimatedGrantSize")} className="input-field" />
        </Field>

        <Field label={t("funding:pipeline.nextAction")}>
          <input type="text" {...register("nextAction")} className="input-field" />
        </Field>

        <Field label={t("funding:pipeline.nextActionDate", "Next Action Date")}>
          <input type="date" {...register("nextActionDate")} className="input-field" />
        </Field>

        <Field label={t("funding:pipeline.sectorTags", "Sector Tags") + " (comma-separated)"}>
          <input type="text" {...register("sectorTags")} className="input-field" placeholder={t("funding:pipeline.placeholders.sectorTagsComma")} />
        </Field>

        <Field label={t("funding:pipeline.notes", "Notes")}>
          <textarea rows={4} {...register("notes")} className="input-field" />
        </Field>
      </div>

      <style>{`
        .input-field {
          width: 100%;
          border-radius: 0.375rem;
          border: 1px solid hsl(var(--input));
          background-color: hsl(var(--background));
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          color: hsl(var(--foreground));
        }
        .input-field:focus {
          outline: none;
          border-color: hsl(var(--ring));
          box-shadow: 0 0 0 1px hsl(var(--ring));
        }
        .input-field::placeholder {
          color: hsl(var(--muted-foreground));
        }
      `}</style>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-36 shrink-0 font-medium text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
