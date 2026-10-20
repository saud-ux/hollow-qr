import { useEffect, useState } from "react";
import type { BenefitAccount, BenefitQuote } from "../../shared/benefits";
import { apiPost, errorText } from "./api";
import { useAuth } from "./auth";
export const benefitCall = <T>(
  action: string,
  data: Record<string, unknown> = {},
) => apiPost<T>("/api/benefits", { action, data });

/** The signed-in customer's own account, kept between pages so Account and the cart show it at once. */
let own: { userId: string; account: BenefitAccount } | null = null;
let inflight: { userId: string; promise: Promise<BenefitAccount> } | null = null;
let generation = 0;

export function forgetOwnBenefits(): void {
  generation += 1;
  own = null;
  inflight = null;
}

/** Loads the customer's own account; `fresh` skips a request already on its way. */
function loadOwn(userId: string, fresh: boolean): Promise<BenefitAccount> {
  if (!fresh && inflight?.userId === userId) return inflight.promise;
  const requestedGeneration = generation;
  const promise = benefitCall<BenefitAccount>("account").then((account) => {
    if (generation === requestedGeneration) own = { userId, account };
    return account;
  });
  inflight = { userId, promise };
  const clear = () => {
    if (inflight?.promise === promise) inflight = null;
  };
  promise.then(clear, clear);
  return promise;
}

/** Loads the customer's own account ahead of time (once), so Account shows it without waiting. */
export function prefetchOwnBenefits(userId: string): void {
  if (own?.userId !== userId) loadOwn(userId, false).catch(() => undefined);
}

export function useBenefits(enabled: boolean, accountId?: string, version = 0) {
  const { session } = useAuth();
  // Another customer's account (staff) is never kept.
  const userId = accountId ? null : (session?.user.id ?? null);
  const [account, setAccount] = useState<BenefitAccount | null>(() => (userId && own?.userId === userId ? own.account : null));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    (userId ? loadOwn(userId, version > 0) : benefitCall<BenefitAccount>("account", accountId ? { accountId } : {}))
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
  }, [enabled, accountId, userId, version]);
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
