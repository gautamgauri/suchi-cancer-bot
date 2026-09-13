import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  getFundingApiBaseURL,
  setFundingApiBaseURL as setApiBaseURLStorage,
} from "../services/fundingApi";

const COMPACT_KEY = "funding_compact_mode";

function getStoredCompact(): boolean {
  try {
    return localStorage.getItem(COMPACT_KEY) === "true";
  } catch {
    return false;
  }
}

function setStoredCompact(value: boolean): void {
  try {
    localStorage.setItem(COMPACT_KEY, value ? "true" : "false");
  } catch {
    /* ignore */
  }
}

interface FundingUiContextValue {
  compact: boolean;
  setCompact: (v: boolean) => void;
  apiBaseUrl: string;
  setApiBaseUrl: (url: string) => void;
  resetUi: () => void;
}

const FundingUiContext = createContext<FundingUiContextValue | null>(null);

export function FundingUiProvider({ children }: { children: React.ReactNode }) {
  const [compact, setCompactState] = useState(getStoredCompact);
  const [apiBaseUrl, setApiBaseUrlState] = useState(getFundingApiBaseURL);

  const setCompact = useCallback((v: boolean) => {
    setStoredCompact(v);
    setCompactState(v);
  }, []);

  const setApiBaseUrl = useCallback((url: string) => {
    const trimmed = url.trim();
    setApiBaseURLStorage(trimmed || "http://localhost:3001/v1");
    setApiBaseUrlState(getFundingApiBaseURL());
  }, []);

  const resetUi = useCallback(() => {
    try {
      localStorage.removeItem("funding_api_base_url");
      localStorage.removeItem("funding_compact_mode");
      localStorage.removeItem("funding_lang");
      setApiBaseURLStorage("http://localhost:3001/v1");
      setApiBaseUrlState(getFundingApiBaseURL());
      setStoredCompact(false);
      setCompactState(false);
      window.location.reload();
    } catch {
      window.location.reload();
    }
  }, []);

  const value = useMemo(
    () => ({
      compact,
      setCompact,
      apiBaseUrl,
      setApiBaseUrl,
      resetUi,
    }),
    [compact, setCompact, apiBaseUrl, setApiBaseUrl, resetUi]
  );

  return (
    <FundingUiContext.Provider value={value}>
      {children}
    </FundingUiContext.Provider>
  );
}

export function useFundingUi(): FundingUiContextValue {
  const ctx = useContext(FundingUiContext);
  if (!ctx) throw new Error("useFundingUi must be used within FundingUiProvider");
  return ctx;
}
