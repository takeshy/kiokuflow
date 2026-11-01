import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { CompatibleProvider } from "~/types/settings";

export type PasswordProvider = "gemini" | "openai" | "jev" | CompatibleProvider;
const PasswordContext = createContext<{
  passwords: Partial<Record<PasswordProvider, string>>;
  setPassword: (provider: PasswordProvider, value: string) => void;
}>({ passwords: {}, setPassword: () => {} });

/** Settings-only memory, cleared on unmount/workspace change. Never persisted in browser storage. */
export function ProviderPasswords({ children }: { children: ReactNode }) {
  const [passwords, setPasswords] = useState<Partial<Record<PasswordProvider, string>>>({});
  const setPassword = useCallback((provider: PasswordProvider, value: string) => {
    setPasswords(previous => {
      const next = { ...previous };
      if (value) next[provider] = value;
      else delete next[provider];
      return next;
    });
  }, []);
  const value = useMemo(() => ({ passwords, setPassword }), [passwords, setPassword]);
  return <PasswordContext.Provider value={value}>{children}</PasswordContext.Provider>;
}

export function useProviderPasswords() { return useContext(PasswordContext); }
