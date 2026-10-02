import { createContext, useContext } from "react";
import type { PublicConfig } from "../../shared/types";

export const ConfigContext = createContext<PublicConfig | null>(null);

export function useConfig(): PublicConfig {
  const config = useContext(ConfigContext);
  if (!config) throw new Error("ConfigContext missing");
  return config;
}

export async function fetchPublicConfig(): Promise<PublicConfig> {
  const res = await fetch("/api/public-config");
  if (!res.ok) throw new Error("config unavailable");
  return (await res.json()) as PublicConfig;
}
