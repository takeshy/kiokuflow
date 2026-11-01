import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

const PasswordContext = createContext<{ password: string; setPassword: (value: string) => void }>({ password: "", setPassword: () => {} });

/** A single settings-only password. Cleared on unmount/workspace change; never persisted in browser storage. */
export function ProviderPasswords({ children }: { children: ReactNode }) {
  const [password, setPassword] = useState("");
  const value = useMemo(() => ({ password, setPassword }), [password]);
  return <PasswordContext.Provider value={value}>{children}</PasswordContext.Provider>;
}
export function useProviderPasswords() { return useContext(PasswordContext); }
