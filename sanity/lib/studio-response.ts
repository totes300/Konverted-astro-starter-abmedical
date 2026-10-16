/** The route's JSON body, or null when something else answered: a host timeout page is plain text. */
export async function readStudioJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function studioFailure(res: Response, payload: { error?: string } | null, fallback: string): string {
  if (payload?.error) {
    return payload.error;
  }

  if (res.status === 504) {
    return "The request took too long. Try again.";
  }

  return fallback;
}
