import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { fundingApiService } from "../../../services/fundingApi";
import type { ActivityType } from "../../../services/fundingApi";
import { EmptyState } from "../EmptyState";
import { DrawerSkeleton } from "../Skeletons";
import { formatDate } from "../../../utils/format";

const ACTIVITY_TYPES: ActivityType[] = ["call", "meeting", "email_sent", "note"];

const addActivitySchema = z.object({
  type: z.enum(["call", "meeting", "email_sent", "note"]),
  notes: z.string().optional(),
}).refine(() => true, { message: "Donor/Org is set from current entry" });

type AddActivityForm = z.infer<typeof addActivitySchema>;

interface ActivityTabProps {
  entryId: string;
  compact?: boolean;
}

export function ActivityTab({ entryId, compact = false }: ActivityTabProps) {
  const { t } = useTranslation("funding");
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [quickLogType, setQuickLogType] = useState<ActivityType | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["pipeline-entry-activities", entryId],
    queryFn: () => fundingApiService.getActivitiesForEntry(entryId),
    enabled: !!entryId,
  });

  const logMutation = useMutation({
    mutationFn: (payload: { type: ActivityType; notes?: string }) =>
      fundingApiService.logActivity({
        orgId: entryId,
        type: payload.type,
        notes: payload.notes || undefined,
      }),
    onSuccess: () => {
      toast.success(t("common:saved"));
      queryClient.invalidateQueries({ queryKey: ["pipeline-entry-activities", entryId] });
      queryClient.invalidateQueries({ queryKey: ["pipeline"] });
      setShowForm(false);
      setQuickLogType(null);
      reset();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to log activity");
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<AddActivityForm>({
    resolver: zodResolver(addActivitySchema),
    defaultValues: { type: "note", notes: "" },
  });

  const activities = data?.activities ?? [];
  const sorted = [...activities].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const onQuickLog = (type: ActivityType) => {
    setQuickLogType(type);
    setValue("type", type);
    setShowForm(true);
  };

  const onSubmit = (form: AddActivityForm) => {
    logMutation.mutate({ type: form.type, notes: form.notes });
  };

  const p = compact ? "p-2" : "p-4";

  if (isLoading) {
    return (
      <div className={p}>
        <DrawerSkeleton />
      </div>
    );
  }

  return (
    <div className={p}>
      <div className="mb-4 flex flex-wrap gap-2">
        {ACTIVITY_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => onQuickLog(type)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label={t(`activity.${type}`)}
          >
            {t(`activity.${type}`)}
          </button>
        ))}
      </div>

      {(showForm || logMutation.isPending) && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="mb-4 rounded-lg border border-border bg-muted/30 p-3"
          aria-label={t("activity.addActivity")}
        >
          <input type="hidden" {...register("type")} />
          <div className="mb-2">
            <label htmlFor="activity-notes" className="block text-sm font-medium text-foreground">
              {t("activity.notes")}
            </label>
            <textarea
              id="activity-notes"
              {...register("notes")}
              placeholder={t("activity.notesPlaceholder")}
              rows={2}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              aria-describedby={errors.notes ? "activity-notes-error" : undefined}
            />
            {errors.notes && (
              <p id="activity-notes-error" className="mt-1 text-xs text-destructive">
                {errors.notes.message}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isSubmitting || logMutation.isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {logMutation.isPending ? t("common:loading") : t("activity.addActivity")}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setQuickLogType(null);
                reset();
              }}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {t("common:cancel")}
            </button>
          </div>
        </form>
      )}

      <h3 className="text-base font-semibold text-foreground">{t("drawer.activity")}</h3>
      {sorted.length === 0 ? (
        <EmptyState message={t("activity.noActivity")} className="mt-4" />
      ) : (
        <ul className="mt-3 space-y-3" role="list">
          {sorted.map((a) => (
            <li
              key={a.id}
              className="rounded-md border border-border bg-card p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full bg-accent/30 px-2 py-0.5 text-xs font-medium text-accent-foreground">
                  {t(`activity.${a.type}`)}
                </span>
                <span className="text-muted-foreground">
                  {formatDate(a.timestamp)}
                </span>
              </div>
              {a.notes && (
                <p className="mt-2 truncate text-foreground" title={a.notes}>
                  {a.notes}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
