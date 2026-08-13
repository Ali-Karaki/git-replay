// Minimal async-data hook over the module-level caches. The cached promise
// resolves instantly on repeat mounts, so navigation never refetches.

import { useEffect, useRef, useState } from "react";

export interface DataState<T> {
  data: T | null;
  loading: boolean;
  error: { message: string; detail?: string | null } | null;
}

export function useData<T>(
  key: string | null,
  load: () => Promise<T>,
): DataState<T> {
  const [state, setState] = useState<DataState<T>>({ data: null, loading: !!key, error: null });
  const seq = useRef(0);

  useEffect(() => {
    if (key === null) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const id = ++seq.current;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    load().then(
      (data) => {
        if (!cancelled && seq.current === id) setState({ data, loading: false, error: null });
      },
      (e) => {
        if (!cancelled && seq.current === id) {
          const err = e as { message?: string; detail?: string | null };
          setState({ data: null, loading: false, error: { message: err.message ?? String(e), detail: err.detail ?? null } });
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
