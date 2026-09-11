import { useCallback, useEffect, useState } from 'react';
import { apiGet } from './api';

export type Loadable<T> = Readonly<{
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}>;

/** Loads a backend resource and exposes its loading and error state. */
export function useResource<T>(path: string): Loadable<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiGet<T>(path)
      .then((result) => {
        if (active) {
          setData(result);
          setError(null);
        }
      })
      .catch((failure: Error) => {
        if (active) {
          setError(failure.message);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { data, error, loading, reload };
}
