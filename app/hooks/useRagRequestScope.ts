import { useRef } from "react";

/** Returning to a previous connection must not resurrect its pending/verified state. */
export function useRagRequestScope(key: string): string {
  const identity = useRef({ key, generation: 0 });
  if (identity.current.key !== key) identity.current = { key, generation: identity.current.generation + 1 };
  return JSON.stringify([key, identity.current.generation]);
}
