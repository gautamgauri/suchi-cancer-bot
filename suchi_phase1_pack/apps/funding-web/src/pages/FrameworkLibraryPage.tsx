import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../components/funding/AppShell";
import { fundingApiService } from "../services/fundingApi";
import { frameworkApi } from "../services/frameworkApi";
import { QUERY_KEYS } from "../services/queryKeys";
import type {
  FrameworkCapability,
  MethodCard,
  ComparableCase,
} from "../services/frameworkApi";

type SectionId = "capabilities" | "mi" | "methods" | "patterns" | "comparables";

export function FrameworkLibraryPage() {
  const { t } = useTranslation(["funding", "common"]);
  const [activeSection, setActiveSection] = useState<SectionId>("capabilities");

  const { isError } = useQuery({
    queryKey: QUERY_KEYS.health.framework,
    queryFn: () => fundingApiService.getHealth(),
    retry: false,
  });
  const apiConfigured = !isError;

  const sections: { id: SectionId; labelKey: string }[] = [
    { id: "capabilities", labelKey: "funding:framework.capabilitiesRef" },
    { id: "mi", labelKey: "funding:framework.miRef" },
    { id: "methods", labelKey: "funding:framework.methodCards" },
    { id: "patterns", labelKey: "funding:framework.patternCards" },
    { id: "comparables", labelKey: "funding:framework.comparableCases" },
  ];

  return (
    <AppShell apiConfigured={apiConfigured}>
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-foreground md:text-2xl">
          {t("funding:framework.nav")}
        </h1>

        <div className="flex flex-wrap gap-2 border-b border-border pb-4">
          {sections.map(({ id, labelKey }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              className={`rounded-md px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring ${
                activeSection === id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground hover:bg-muted/80"
              }`}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>

        {activeSection === "capabilities" && <CapabilitiesSection />}
        {activeSection === "mi" && <MISection />}
        {activeSection === "methods" && <MethodCardsSection />}
        {activeSection === "patterns" && <PatternCardsSection />}
        {activeSection === "comparables" && <ComparableCasesSection />}
      </div>
    </AppShell>
  );
}

function CapabilitiesSection() {
  const { t } = useTranslation(["funding", "common"]);
  const { data: list = [], isLoading, isError, error } = useQuery({
    queryKey: QUERY_KEYS.framework.capabilities,
    queryFn: () => frameworkApi.listCapabilities(),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common:loading") as string}</p>;
  if (isError) return <p className="text-sm text-destructive">{t("funding:errors.loadFailed")}: {(error as Error)?.message}</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("funding:framework.capabilitiesDesc")}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((c) => (
          <CapabilityCard key={c.id} cap={c} />
        ))}
      </div>
    </div>
  );
}

function CapabilityCard({ cap }: { cap: FrameworkCapability }) {
  const { t } = useTranslation("funding");
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left font-medium text-foreground hover:opacity-90"
      >
        <span>{cap.capabilityId} – {cap.name}</span>
        <span className="text-muted-foreground">{open ? "▼" : "▶"}</span>
      </button>
      <p className="mt-1 text-sm text-muted-foreground">{cap.definitionShort}</p>
      {open && (
        <div className="mt-3 space-y-2 border-t border-border pt-3 text-sm">
          {cap.definitionLong && (
            <p className="text-foreground">{cap.definitionLong}</p>
          )}
          {cap.biharContextExamples?.length ? (
            <div>
              <span className="font-medium text-foreground">{t("framework.biharExamples")}: </span>
              <span className="text-muted-foreground">{cap.biharContextExamples.join("; ")}</span>
            </div>
          ) : null}
          {cap.measurementIdeas?.length ? (
            <div>
              <span className="font-medium text-foreground">{t("framework.measurementIdeas")}: </span>
              <span className="text-muted-foreground">{cap.measurementIdeas.join("; ")}</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function MISection() {
  const { t } = useTranslation(["funding", "common"]);
  const { data: list = [], isLoading, isError, error } = useQuery({
    queryKey: QUERY_KEYS.framework.miModalities,
    queryFn: () => frameworkApi.listMIModalities(),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common:loading") as string}</p>;
  if (isError) return <p className="text-sm text-destructive">{t("funding:errors.loadFailed")}: {(error as Error)?.message}</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("funding:framework.miDesc")}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {list.map((m) => (
          <div
            key={m.id}
            className="rounded-lg border border-border bg-card p-3 shadow-sm"
          >
            <h4 className="font-medium text-foreground">{m.miId} – {m.name}</h4>
            <p className="mt-1 text-sm text-muted-foreground">{m.definitionShort}</p>
            {m.activitySignals?.length ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("funding:framework.signals")}: {m.activitySignals.join(", ")}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function MethodCardsSection() {
  const { t } = useTranslation(["funding", "common"]);
  const { data: list = [], isLoading, isError, error } = useQuery({
    queryKey: QUERY_KEYS.framework.methodCards,
    queryFn: () => frameworkApi.listMethodCards({ status: "validated", limit: 50 }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common:loading") as string}</p>;
  if (isError) return <p className="text-sm text-destructive">{t("funding:errors.loadFailed")}: {(error as Error)?.message}</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("funding:framework.methodCardsDesc")}
      </p>
      <div className="space-y-3">
        {list.map((card) => (
          <MethodCardRow key={card.id} card={card} />
        ))}
        {list.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("funding:framework.noMethodCards")}</p>
        )}
      </div>
    </div>
  );
}

function MethodCardRow({ card }: { card: MethodCard }) {
  const { t } = useTranslation("funding");
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left font-medium text-foreground hover:opacity-90"
      >
        <span>{card.title}</span>
        <span className="text-muted-foreground">{open ? "▼" : "▶"}</span>
      </button>
      <p className="mt-1 text-sm text-muted-foreground">{card.intent}</p>
      <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
        {card.miTagsPrimary?.map((mi) => <span key={mi} className="rounded bg-muted px-1.5 py-0.5">{mi}</span>)}
        {card.capabilityLinks?.map((c) => <span key={c} className="rounded bg-muted px-1.5 py-0.5">{c}</span>)}
      </div>
      {open && (
        <div className="mt-3 border-t border-border pt-3 text-sm">
          {card.steps?.length ? (
            <ol className="list-decimal space-y-1 pl-4">
              {card.steps.map((s, i) => (
                <li key={i} className="text-foreground">{s}</li>
              ))}
            </ol>
          ) : null}
          {card.whenToUse && (
            <p className="mt-2 text-muted-foreground"><strong>{t("framework.whenToUse")}:</strong> {card.whenToUse}</p>
          )}
        </div>
      )}
    </div>
  );
}

function PatternCardsSection() {
  const { t } = useTranslation(["funding", "common"]);
  const { data: list = [], isLoading, isError, error } = useQuery({
    queryKey: QUERY_KEYS.framework.patternCards,
    queryFn: () => frameworkApi.listPatternCards({ status: "validated", limit: 50 }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common:loading") as string}</p>;
  if (isError) return <p className="text-sm text-destructive">{t("funding:errors.loadFailed")}: {(error as Error)?.message}</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("funding:framework.patternCardsDesc")}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {list.map((card) => (
          <div key={card.id} className="rounded-lg border border-border bg-card p-3 shadow-sm">
            <h4 className="font-medium text-foreground">{card.title}</h4>
            {card.durationMins != null && (
              <p className="text-xs text-muted-foreground">{card.durationMins} min</p>
            )}
            <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
              {card.miTagsPrimary?.map((mi) => <span key={mi} className="rounded bg-muted px-1.5 py-0.5">{mi}</span>)}
              {card.capabilitiesPrimary?.map((c) => <span key={c} className="rounded bg-muted px-1.5 py-0.5">{c}</span>)}
            </div>
            {card.adaptations?.length ? (
              <p className="mt-2 text-xs text-muted-foreground">{card.adaptations.join("; ")}</p>
            ) : null}
          </div>
        ))}
        {list.length === 0 && (
          <p className="col-span-2 text-sm text-muted-foreground">{t("funding:framework.noPatternCards")}</p>
        )}
      </div>
    </div>
  );
}

function ComparableCasesSection() {
  const { t } = useTranslation(["funding", "common"]);
  const { data: list = [], isLoading, isError, error } = useQuery({
    queryKey: QUERY_KEYS.framework.comparableCases,
    queryFn: () => frameworkApi.listComparableCases({ status: "validated", limit: 50 }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common:loading") as string}</p>;
  if (isError) return <p className="text-sm text-destructive">{t("funding:errors.loadFailed")}: {(error as Error)?.message}</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("funding:framework.comparableCasesDesc")}
      </p>
      <div className="space-y-3">
        {list.map((c) => (
          <ComparableCaseRow key={c.id} case_={c} />
        ))}
        {list.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("funding:framework.noComparableCases")}</p>
        )}
      </div>
    </div>
  );
}

function ComparableCaseRow({ case_: c }: { case_: ComparableCase }) {
  const { t } = useTranslation("funding");
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left font-medium text-foreground hover:opacity-90"
      >
        <span>{c.programName} – {c.orgName}</span>
        <span className="text-muted-foreground">{open ? "▼" : "▶"}</span>
      </button>
      <p className="mt-1 text-xs text-muted-foreground">{c.geography} · {c.targetGroup}</p>
      <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
        {c.capabilitiesPrimary?.map((cap) => <span key={cap} className="rounded bg-muted px-1.5 py-0.5">{cap}</span>)}
      </div>
      {open && (
        <div className="mt-3 border-t border-border pt-3 text-sm text-foreground">
          <p>{c.outcomesSummary}</p>
          {c.transferabilityBihar && (
            <p className="mt-2 text-muted-foreground"><strong>{t("framework.biharTransfer")}:</strong> {c.transferabilityBihar}</p>
          )}
        </div>
      )}
    </div>
  );
}
