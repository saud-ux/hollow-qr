import { useEffect, useState } from "react";
import type { BenefitAccount, BenefitQuote } from "../../shared/benefits";
import { apiPost, errorText } from "./api";
export const benefitCall = <T>(
  action: string,
  data: Record<string, unknown> = {},
) => apiPost<T>("/api/benefits", { action, data });
export function useBenefits(enabled: boolean, accountId?: string, version = 0) {
  const [account, setAccount] = useState<BenefitAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    benefitCall<BenefitAccount>("account", accountId ? { accountId } : {})
      .then((a) => {
        if (live) {
          setAccount(a);
          setError(null);
        }
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [enabled, accountId, version]);
  return { account: enabled ? account : null, error };
}
export function useBenefitQuote(
  enabled: boolean,
  data: Record<string, unknown>,
) {
  const key = JSON.stringify(data);
  const [result, setResult] = useState<{
    key: string;
    quote?: BenefitQuote;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const timer = setTimeout(() => {
      benefitCall<BenefitQuote>(
        "quote",
        JSON.parse(key) as Record<string, unknown>,
      )
        .then((quote) => {
          if (live) setResult({ key, quote });
        })
        .catch((e) => {
          if (live) setResult({ key, error: errorText(e) });
        });
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [enabled, key]);
  return {
    quote: enabled && result?.key === key ? result.quote : null,
    error: enabled && result?.key === key ? result.error : null,
    pending: enabled && result?.key !== key,
  };
}
