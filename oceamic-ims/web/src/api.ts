// Thin API client. Every call goes through the backend: the frontend never
// recomputes stock and never decides permissions on its own.

export type ApiError = Readonly<{ code: string; message: string }>;

export class RequestFailed extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RequestFailed';
    this.code = code;
  }
}

async function request<T>(method: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === null ? {} : { 'content-type': 'application/json' },
    body: body === null ? null : JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiError | null;
    throw new RequestFailed(
      payload?.code ?? 'ERREUR_RESEAU',
      payload?.message ?? "Le serveur n'a pas pu traiter la demande.",
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>('GET', path, null);
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>('POST', path, body);
}

export function buildQuery(parameters: Readonly<Record<string, string | null>>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== null && value !== '') {
      search.set(key, value);
    }
  }
  const query = search.toString();
  return query === '' ? '' : `?${query}`;
}
