import { HttpError, type HttpErrorPayload } from "@/network/httpError";

async function parseError(res: Response): Promise<HttpError> {
  let payload: HttpErrorPayload | null = null;

  try {
    payload = (await res.json()) as HttpErrorPayload;
  } catch {
    payload = null;
  }

  return new HttpError(
    res.status,
    payload?.message || `Request failed with status ${res.status}`,
    payload?.code,
  );
}

export async function requestJson<T>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    throw await parseError(res);
  }
  return (await res.json()) as T;
}
