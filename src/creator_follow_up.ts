import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { InfraiError, infraiCall } from "./infrai_rest.ts";

const followUp = z.object({
  kind: z.enum(["digital_asset_delivery", "subscriber_update", "content_processing"]),
  reference: z.string().min(1),
  destination: z.string().url(),
  delayHours: z.number().int().min(1).max(24)
}).strict();
type FollowUp = z.infer<typeof followUp>;
type Pending = { input: FollowUp; dueAt: number; jobId: string; state: "pending" | "running" | "done" };

export function isDue(item: Pick<Pending, "dueAt" | "state">, now: number): boolean {
  return item.state === "pending" && now >= item.dueAt;
}

const pending = new Map<string, Pending>();
const apiKey = process.env.INFRAI_API_KEY;
const publicUrl = process.env.PUBLIC_URL;

function reply(response: import("node:http").ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function readBody(request: import("node:http").IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of request) {
    text += chunk.toString();
    if (text.length > 16_384) throw new Error("Request body too large");
  }
  return JSON.parse(text);
}

export function start(): void {
  if (!apiKey || !publicUrl) throw new Error("Set INFRAI_API_KEY and PUBLIC_URL");
  const callbackBase = new URL(publicUrl);
  createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    try {
      if (request.method === "POST" && url.pathname === "/follow-ups") {
        const input = followUp.parse(await readBody(request));
        const id = randomUUID();
        const dueAt = Date.now() + input.delayHours * 3_600_000;
        const date = new Date(Math.ceil(dueAt / 60_000) * 60_000);
        const cron_expr = `${date.getUTCMinutes()} ${date.getUTCHours()} ${date.getUTCDate()} ${date.getUTCMonth() + 1} *`;
        const task = new URL(`/run/${id}`, callbackBase).toString();
        const created = await infraiCall<{ job_id: string }>("POST", "/v1/cron/create", { cron_expr, task }, id);
        pending.set(id, { input, dueAt, jobId: created.job_id, state: "pending" });
        return reply(response, 201, { id, dueAt: new Date(dueAt).toISOString(), jobId: created.job_id });
      }
      if (request.method === "POST" && url.pathname.startsWith("/run/")) {
        const id = url.pathname.slice(5);
        const item = pending.get(id);
        if (!item) return reply(response, 404, { error: "Unknown follow-up" });
        if (!isDue(item, Date.now())) return reply(response, 200, { id, state: item.state });
        item.state = "running";
        try {
          const delivered = await fetch(item.input.destination, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Idempotency-Key": id },
            body: JSON.stringify({ kind: item.input.kind, reference: item.input.reference })
          });
          if (!delivered.ok) throw new Error(`Destination returned HTTP ${delivered.status}`);
          await infraiCall("DELETE", `/v1/cron/delete/${encodeURIComponent(item.jobId)}`, undefined, id);
          item.state = "done";
          return reply(response, 200, { id, state: "done", kind: item.input.kind, reference: item.input.reference });
        } catch (error) {
          item.state = "pending";
          const exception = error instanceof Error ? error : new Error(String(error));
          await infraiCall("POST", "/v1/errors/capture", {
            message: exception.message, exception: exception.stack ?? exception.toString()
          }, `${id}-error`);
          throw error;
        }
      }
      reply(response, 404, { error: "Not found" });
    } catch (error) {
      const status = error instanceof z.ZodError || error instanceof SyntaxError ? 400
        : error instanceof InfraiError && error.status >= 400 && error.status < 500 ? error.status : 502;
      reply(response, status, { error: error instanceof Error ? error.message : String(error) });
    }
  }).listen(Number(process.env.PORT ?? 3000), () => console.log("Follow-up service listening"));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) start();
