import { useEffect, useRef, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { fundingApiService, PipelineStage } from "../../services/fundingApi";
import { frameworkApi } from "../../services/frameworkApi";

const STAGE_OPTIONS: PipelineStage[] = ["lead", "qualified", "proposal_sent", "won", "lost"];

function getCreateEntrySchema(orgNameRequiredMsg: string) {
  return z.object({
    orgName: z.string().min(1, orgNameRequiredMsg),
    contactName: z.string().optional(),
    contactEmail: z.string().email().optional().or(z.literal("")),
    stage: z.enum(["lead", "qualified", "proposal_sent", "won", "lost"]).default("lead"),
    owner: z.string().optional(),
    nextAction: z.string().optional(),
    nextActionDate: z.string().optional(),
    probability: z.coerce.number().min(0).max(100).optional(),
    notes: z.string().optional(),
    geography: z.string().optional(),
    estimatedGrantSize: z.string().optional(),
    sectorTags: z.string().optional(),
  });
}
type CreateEntryForm = z.infer<ReturnType<typeof getCreateEntrySchema>>;

interface CreateEntryModalProps {
  onClose: () => void;
}

const CAPABILITY_PRESETS = [
  { id: "education" as const, capabilityIds: ["C4", "C6", "C7"], labelKey: "funding:framework.presetEducation", descKey: "funding:framework.presetEducationDesc" },
  { id: "health" as const, capabilityIds: ["C1", "C2", "C3"], labelKey: "funding:framework.presetHealth", descKey: "funding:framework.presetHealthDesc" },
  { id: "empowerment" as const, capabilityIds: ["C6", "C7", "C10"], labelKey: "funding:framework.presetEmpowerment", descKey: "funding:framework.presetEmpowermentDesc" },
];

export function CreateEntryModal({ onClose }: CreateEntryModalProps) {
  const { t } = useTranslation(["funding", "common"]);
  const queryClient = useQueryClient();
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);
  const [capabilityPreset, setCapabilityPreset] = useState<"education" | "health" | "empowerment" | null>(null);
  const createEntrySchema = useMemo(
    () => getCreateEntrySchema(t("funding:validation.orgNameRequired")),
    [t]
  );

  const createMutation = useMutation({
    mutationFn: async (data: CreateEntryForm) => {
      const payload = {
        ...data,
        contactEmail: data.contactEmail || undefined,
        sectorTags: data.sectorTags ? data.sectorTags.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      };
      const entry = await fundingApiService.createEntry(payload);
      const preset = capabilityPreset ? CAPABILITY_PRESETS.find((p) => p.id === capabilityPreset) : null;
      if (entry?.id && preset?.capabilityIds?.length) {
        await frameworkApi.tagProject(entry.id, {
          tags: preset.capabilityIds.map((capabilityId) => ({
            capabilityId,
            isPrimary: true,
            strength: null,
            isApplicable: true,
          })),
        });
      }
      return entry;
    },
    onSuccess: () => {
      toast.success(t("common:saved"));
      queryClient.invalidateQueries({ queryKey: ["pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["framework"] });
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message || t("funding:errors.createEntryFailed"));
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateEntryForm>({
    resolver: zodResolver(createEntrySchema),
    defaultValues: {
      stage: "lead",
      probability: 10,
    },
  });

  // Focus trap and escape key handling
  useEffect(() => {
    previousActiveRef.current = document.activeElement as HTMLElement;
    modalRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousActiveRef.current?.focus();
    };
  }, [onClose]);

  const onSubmit = (data: CreateEntryForm) => {
    createMutation.mutate(data);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-entry-title"
        tabIndex={-1}
        className="fixed inset-4 z-50 mx-auto my-auto flex max-h-[90vh] max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="create-entry-title" className="text-lg font-semibold text-foreground">
            {t("funding:pipeline.createEntry")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label={t("common:close")}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-y-auto p-4">
          <div className="space-y-4">
            {/* Org Name (required) */}
            <div>
              <label htmlFor="orgName" className="block text-sm font-medium text-foreground">
                {t("funding:pipeline.orgName", "Organization Name")} *
              </label>
              <input
                id="orgName"
                type="text"
                {...register("orgName")}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder={t("funding:pipeline.placeholders.orgName")}
              />
              {errors.orgName && (
                <p className="mt-1 text-xs text-destructive">{errors.orgName.message}</p>
              )}
            </div>

            {/* Contact Name */}
            <div>
              <label htmlFor="contactName" className="block text-sm font-medium text-foreground">
                {t("funding:pipeline.contactName", "Contact Name")}
              </label>
              <input
                id="contactName"
                type="text"
                {...register("contactName")}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            {/* Contact Email */}
            <div>
              <label htmlFor="contactEmail" className="block text-sm font-medium text-foreground">
                {t("funding:pipeline.contactEmail", "Contact Email")}
              </label>
              <input
                id="contactEmail"
                type="email"
                {...register("contactEmail")}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {errors.contactEmail && (
                <p className="mt-1 text-xs text-destructive">{errors.contactEmail.message}</p>
              )}
            </div>

            {/* Stage */}
            <div>
              <label htmlFor="stage" className="block text-sm font-medium text-foreground">
                {t("funding:pipeline.stage", "Stage")}
              </label>
              <select
                id="stage"
                {...register("stage")}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {STAGE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {t(`funding:pipeline.stages.${s}`, s)}
                  </option>
                ))}
              </select>
            </div>

            {/* Owner */}
            <div>
              <label htmlFor="owner" className="block text-sm font-medium text-foreground">
                {t("funding:pipeline.owner", "Owner")}
              </label>
              <input
                id="owner"
                type="text"
                {...register("owner")}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            {/* Probability */}
            <div>
              <label htmlFor="probability" className="block text-sm font-medium text-foreground">
                {t("funding:pipeline.probability", "Probability")} (0-100%)
              </label>
              <input
                id="probability"
                type="number"
                min={0}
                max={100}
                {...register("probability")}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            {/* Geography */}
            <div>
              <label htmlFor="geography" className="block text-sm font-medium text-foreground">
                {t("funding:pipeline.geography", "Geography")}
              </label>
              <input
                id="geography"
                type="text"
                {...register("geography")}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder={t("funding:pipeline.placeholders.geography")}
              />
            </div>

            {/* Estimated Grant Size */}
            <div>
              <label htmlFor="estimatedGrantSize" className="block text-sm font-medium text-foreground">
                {t("funding:pipeline.estimatedGrantSize", "Estimated Grant Size")}
              </label>
              <input
                id="estimatedGrantSize"
                type="text"
                {...register("estimatedGrantSize")}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder={t("funding:pipeline.placeholders.grantSize")}
              />
            </div>

            {/* Next Action */}
            <div>
              <label htmlFor="nextAction" className="block text-sm font-medium text-foreground">
                {t("funding:pipeline.nextAction", "Next Action")}
              </label>
              <input
                id="nextAction"
                type="text"
                {...register("nextAction")}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder={t("funding:pipeline.placeholders.nextAction")}
              />
            </div>

            {/* Sector Tags */}
            <div>
              <label htmlFor="sectorTags" className="block text-sm font-medium text-foreground">
                {t("funding:pipeline.sectorTags", "Sector Tags")} (comma-separated)
              </label>
              <input
                id="sectorTags"
                type="text"
                {...register("sectorTags")}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder={t("funding:pipeline.placeholders.sectorTags")}
              />
            </div>

            {/* Notes */}
            <div>
              <label htmlFor="notes" className="block text-sm font-medium text-foreground">
                {t("funding:pipeline.notes", "Notes")}
              </label>
              <textarea
                id="notes"
                rows={3}
                {...register("notes")}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            {/* Capability preset (optional) */}
            <div>
              <span className="block text-sm font-medium text-foreground mb-2">
                {t("funding:framework.presets", "Capability presets")} ({t("common:optional", "optional")})
              </span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCapabilityPreset(null)}
                  className={`rounded-md border px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring ${capabilityPreset === null ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground hover:bg-muted"}`}
                >
                  {t("common:none", "None")}
                </button>
                {CAPABILITY_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setCapabilityPreset(p.id)}
                    className={`rounded-md border px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring ${capabilityPreset === p.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground hover:bg-muted"}`}
                    title={t(p.descKey)}
                  >
                    {t(p.labelKey)}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("funding:framework.presetEducationDesc")} / {t("funding:framework.presetHealthDesc")} / {t("funding:framework.presetEmpowermentDesc")}
              </p>
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {t("common:cancel")}
          </button>
          <button
            type="submit"
            onClick={handleSubmit(onSubmit)}
            disabled={isSubmitting || createMutation.isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {createMutation.isPending ? t("common:loading") : t("common:save")}
          </button>
        </div>
      </div>
    </>
  );
}
