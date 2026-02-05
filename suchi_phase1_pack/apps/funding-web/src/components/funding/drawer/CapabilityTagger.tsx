import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { frameworkApi } from "../../../services/frameworkApi";
import { QUERY_KEYS } from "../../../services/queryKeys";

const MAX_PRIMARY = 3;
const MAX_SECONDARY = 3;

interface TagEntry {
  capabilityId: string;
  name: string;
  isPrimary: boolean;
  strength: number | null;
  isApplicable: boolean;
}

interface CapabilityTaggerProps {
  entryId: string;
  compact?: boolean;
}

export function CapabilityTagger({ entryId, compact = false }: CapabilityTaggerProps) {
  const { t } = useTranslation(["funding", "common"]);
  const queryClient = useQueryClient();
  const [localTags, setLocalTags] = useState<TagEntry[] | null>(null);

  const { data: capabilities = [], isLoading: capsLoading, isError: capsError } = useQuery({
    queryKey: QUERY_KEYS.framework.capabilities,
    queryFn: () => frameworkApi.listCapabilities(),
  });

  const { data: projectTags, isLoading: tagsLoading } = useQuery({
    queryKey: QUERY_KEYS.framework.projectTags(entryId),
    queryFn: () => frameworkApi.getProjectTags(entryId),
    enabled: !!entryId,
  });

  const tagMutation = useMutation({
    mutationFn: (payload: { tags: Array<{ capabilityId: string; isPrimary: boolean; strength: number | null; isApplicable: boolean }> }) =>
      frameworkApi.tagProject(entryId, payload),
    onSuccess: () => {
      toast.success(t("common:saved"));
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.framework.projectTags(entryId) });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.pipeline.entry(entryId) });
      setLocalTags(null);
    },
    onError: (err: Error) => {
      toast.error(err.message || t("funding:errors.saveFailed"));
    },
  });

  const tags = localTags ?? (projectTags?.capabilities ?? []).map((c) => ({
    capabilityId: c.capabilityId,
    name: c.name,
    isPrimary: c.isPrimary,
    strength: c.strength,
    isApplicable: c.isApplicable,
  }));

  const primaryTags = useMemo(() => tags.filter((t) => t.isPrimary), [tags]);
  const secondaryTags = useMemo(() => tags.filter((t) => !t.isPrimary), [tags]);
  const capById = useMemo(() => new Map(capabilities.map((c) => [c.capabilityId, c])), [capabilities]);

  const addPrimary = (capabilityId: string) => {
    if (primaryTags.length >= MAX_PRIMARY) return;
    const cap = capById.get(capabilityId);
    if (!cap || tags.some((t) => t.capabilityId === capabilityId)) return;
    setLocalTags([
      ...tags,
      { capabilityId, name: cap.name, isPrimary: true, strength: null, isApplicable: true },
    ]);
  };

  const addSecondary = (capabilityId: string) => {
    if (secondaryTags.length >= MAX_SECONDARY) return;
    const cap = capById.get(capabilityId);
    if (!cap || tags.some((t) => t.capabilityId === capabilityId)) return;
    setLocalTags([
      ...tags,
      { capabilityId, name: cap.name, isPrimary: false, strength: null, isApplicable: true },
    ]);
  };

  const remove = (capabilityId: string) => {
    setLocalTags(tags.filter((t) => t.capabilityId !== capabilityId));
  };

  const updateEntry = (capabilityId: string, patch: Partial<TagEntry>) => {
    setLocalTags(
      tags.map((t) =>
        t.capabilityId === capabilityId ? { ...t, ...patch } : t
      )
    );
  };

  const handleSave = () => {
    tagMutation.mutate({
      tags: tags.map((t) => ({
        capabilityId: t.capabilityId,
        isPrimary: t.isPrimary,
        strength: t.strength,
        isApplicable: t.isApplicable,
      })),
    });
  };

  const isDirty = localTags !== null;
  const p = compact ? "p-2" : "p-4";

  if (capsLoading) {
    return (
      <div className={p}>
        <p className="text-sm text-muted-foreground">{t("common:loading")}</p>
      </div>
    );
  }

  if (capsError) {
    return (
      <div className={p}>
        <p className="text-sm text-destructive">{t("funding:errors.loadFailed")}</p>
      </div>
    );
  }

  const primaryLimitReached = primaryTags.length >= MAX_PRIMARY;
  const secondaryLimitReached = secondaryTags.length >= MAX_SECONDARY;

  return (
    <div className={p}>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">
          {t("funding:framework.capabilityTags", "Capability tags")}
        </h4>
        {isDirty && (
          <button
            type="button"
            onClick={handleSave}
            disabled={tagMutation.isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {tagMutation.isPending ? t("common:loading") : t("common:save")}
          </button>
        )}
      </div>

      {/* Primary (max 3) */}
      <div className="mb-3">
        <label className={`block text-xs font-medium mb-1 ${primaryLimitReached ? "text-amber-600" : "text-muted-foreground"}`}>
          {t("funding:framework.primaryCapabilities", "Primary")} ({primaryTags.length}/{MAX_PRIMARY})
        </label>
        <select
          className={`w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring ${
            primaryLimitReached
              ? "border-amber-300 bg-amber-50 text-muted-foreground cursor-not-allowed"
              : "border-input bg-background text-foreground focus:border-ring"
          }`}
          value=""
          disabled={primaryLimitReached}
          onChange={(e) => {
            const v = e.target.value;
            if (v) {
              addPrimary(v);
              e.target.value = "";
            }
          }}
        >
          <option value="">
            {primaryLimitReached
              ? t("funding:framework.limitReached", "Limit reached")
              : t("funding:framework.addCapability", "Add…")}
          </option>
          {capabilities
            .filter((c) => !tags.some((t) => t.capabilityId === c.capabilityId))
            .map((c) => (
              <option key={c.id} value={c.capabilityId}>
                {c.capabilityId} – {c.name}
              </option>
            ))}
        </select>
        <div className="mt-2 flex flex-wrap gap-2">
          {primaryTags.map((t) => (
            <TagChip
              key={t.capabilityId}
              entry={t}
              onRemove={() => remove(t.capabilityId)}
              onUpdate={(patch) => updateEntry(t.capabilityId, patch)}
              compact={compact}
            />
          ))}
        </div>
      </div>

      {/* Secondary (max 3) */}
      <div className="mb-3">
        <label className={`block text-xs font-medium mb-1 ${secondaryLimitReached ? "text-amber-600" : "text-muted-foreground"}`}>
          {t("funding:framework.secondaryCapabilities", "Secondary")} ({secondaryTags.length}/{MAX_SECONDARY})
        </label>
        <select
          className={`w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring ${
            secondaryLimitReached
              ? "border-amber-300 bg-amber-50 text-muted-foreground cursor-not-allowed"
              : "border-input bg-background text-foreground focus:border-ring"
          }`}
          value=""
          disabled={secondaryLimitReached}
          onChange={(e) => {
            const v = e.target.value;
            if (v) {
              addSecondary(v);
              e.target.value = "";
            }
          }}
        >
          <option value="">
            {secondaryLimitReached
              ? t("funding:framework.limitReached", "Limit reached")
              : t("funding:framework.addCapability", "Add…")}
          </option>
          {capabilities
            .filter((c) => !tags.some((t) => t.capabilityId === c.capabilityId))
            .map((c) => (
              <option key={c.id} value={c.capabilityId}>
                {c.capabilityId} – {c.name}
              </option>
            ))}
        </select>
        <div className="mt-2 flex flex-wrap gap-2">
          {secondaryTags.map((t) => (
            <TagChip
              key={t.capabilityId}
              entry={t}
              onRemove={() => remove(t.capabilityId)}
              onUpdate={(patch) => updateEntry(t.capabilityId, patch)}
              compact={compact}
            />
          ))}
        </div>
      </div>

      {tagsLoading && tags.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("common:loading")}</p>
      )}
    </div>
  );
}

function TagChip({
  entry,
  onRemove,
  onUpdate,
  compact,
}: {
  entry: TagEntry;
  onRemove: () => void;
  onUpdate: (patch: Partial<TagEntry>) => void;
  compact: boolean;
}) {
  const { t } = useTranslation("funding");

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 ${compact ? "px-2 py-0.5 text-xs" : "px-2 py-1 text-sm"}`}
    >
      <span className="font-medium text-foreground">
        {entry.capabilityId} {entry.name}
      </span>
      <select
        className="max-w-[4rem] rounded border-0 bg-transparent text-muted-foreground focus:ring-1 focus:ring-ring"
        value={entry.strength ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onUpdate({ strength: v === "" ? null : Number(v) });
        }}
        title={t("funding:framework.strength", "Strength 1-5")}
      >
        <option value="">—</option>
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
      <label className="flex items-center gap-0.5 text-muted-foreground whitespace-nowrap">
        <input
          type="checkbox"
          checked={!entry.isApplicable}
          onChange={(e) => onUpdate({ isApplicable: !e.target.checked })}
          className="rounded border-input"
        />
        <span className="text-xs">{t("funding:framework.notApplicable", "N/A")}</span>
      </label>
      <button
        type="button"
        onClick={onRemove}
        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        aria-label={t("common:remove", "Remove")}
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
