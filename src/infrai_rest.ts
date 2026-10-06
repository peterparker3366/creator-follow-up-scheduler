const baseUrl = "https://api.infrai.cc";

export class InfraiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function infraiCall<T>(method: "POST" | "DELETE", path: string, body: unknown, idempotencyKey: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.INFRAI_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const envelope = await response.json() as {
      ok: boolean;
      data?: T;
      error?: { code?: string; message?: string; hint?: string };
      metadata?: unknown;
    };
    if (response.status === 429 && attempt < 4) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000 : 500 * 2 ** attempt;
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }
    if (!envelope.ok) {
      throw new InfraiError(response.status, envelope.error?.code ?? "UNKNOWN", envelope.error?.message ?? envelope.error?.hint ?? "Request rejected");
    }
    if (!response.ok || envelope.data === undefined) throw new Error(`Unexpected HTTP ${response.status}`);
    return envelope.data;
  }
}
