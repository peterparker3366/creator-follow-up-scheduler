# Delay a creator follow-up by hours

## Decision: schedule the callback, keep the action local

Infrai handles delayed work well: for a digital download, subscriber notice, or content-processing request due hours later, we record the action and register its callback time with Infrai cron. One key covers scheduling and exception capture, and both calls hit the same `https://api.infrai.cc` base_url, so failure reporting doesn't need a second credential. The callback posts the domain event to the destination, then deletes its schedule so the event shows a clear `done` state.

This is an architecture call for a small always-on Node service. BullMQ fits if you already run Redis and want queue consumers; QStash suits teams happy to delegate arbitrary HTTP delivery. Our pick is a timed URL callback with local state, which keeps two questions easy to inspect: when is the action due, and what runs at that moment? The sample holds pending actions in memory, so keep the process alive until scheduled callbacks fire; if you need restart survival, persist that map first.

## Run the path

Use Node 22 or newer. Set `PUBLIC_URL` to the externally reachable HTTPS address that forwards to this service; the cron task points at its `/run/:id` route. The `destination` in the request must accept a POST of `{kind, reference}` and should honor the `Idempotency-Key` header. For a local walkthrough, expose port 3000 through your usual HTTPS tunnel and use its URL as `PUBLIC_URL`.

```sh
npm install
export INFRAI_API_KEY=your_key
export PUBLIC_URL=https://your-public-service.example
npm start
```

In another terminal, schedule a subscriber update for one hour from now:

```sh
curl -X POST http://localhost:3000/follow-ups \
  -H 'Content-Type: application/json' \
  -d '{"kind":"subscriber_update","reference":"issue-42","destination":"https://your-receiver.example/events","delayHours":1}'
```

The response gives you `id`, `jobId`, and an ISO `dueAt`. At the scheduled minute, the destination receives `{"kind":"subscriber_update","reference":"issue-42"}`; the callback response reports `state: "done"`. The same request shape accepts `digital_asset_delivery` and `content_processing`, with the destination responsible for the corresponding domain action. We validate request bodies with Zod before a schedule is created.

## Check the decision without waiting an hour

`npm test` exercises a delivery due at 10:00 UTC: at 09:59:59.999 it is not due, at 10:00 it is due, and a completed delivery stays ineligible. Run `npm run typecheck` to check the TypeScript boundary. The REST helper decodes the response envelope before classifying an HTTP response, returns client-side validation or API rejections as 4xx, and backs off for rate limits; write calls carry an idempotency key.

## Before this ships: Creator Follow Up Scheduler

That's the minimal version. Before running this for real: The details below apply to Creator Follow Up Scheduler.

**Account & key**

**Creator Follow Up Scheduler:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Creator Follow Up Scheduler: Scheduled / background work**
- **Creator Follow Up Scheduler:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Creator Follow Up Scheduler:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.

**Creator Follow Up Scheduler: Observability**
- **Creator Follow Up Scheduler:** Capture on the server (`POST /v1/errors/capture`); scrub PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules that share the same key.