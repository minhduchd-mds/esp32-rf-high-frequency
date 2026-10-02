# Local receive-only gateway — v0.10

Run the UI at `http://localhost:8080` or `http://127.0.0.1:8080`.
Create a new raw journal for each receiver run:

```sh
RF_ARCHIVE_PATH=/absolute/new-session.jsonl node scripts/gateway.mjs < receiver-output.jsonl
```

For continuous acquisition, pipe the output of an independently configured receive-only acquisition process into the gateway. No vendor driver or shell command executor is provided.

- Listen: `127.0.0.1:8787`; optional `RF_GATEWAY_PORT` for API clients (the bundled UI uses 8787).
- GET `/health`: archive state and accepted/rejected/missing/slow-client counts.
- GET `/events`: validated Spectrum v2 SSE, unique stream/event IDs, 64-frame reconnect replay.
- Unknown/expired Last-Event-ID: HTTP 409; never silently joins unrelated evidence.
- No mutating HTTP methods, RF control or retuning endpoints.
- Allowed browser origins: the two localhost:8080 URLs; no wildcard CORS.
- Host restricted to localhost/127.0.0.1 and port; at most eight SSE clients.
- Maximum input line 65,536 bytes, enforced during streaming. Oversized data is discarded through the next newline.
- Slow clients are disconnected; no unbounded output queue. Heartbeat keeps idle streams observable.
- Exclusive new journal creation, mode 0600, synchronous write+fsync before publication. Existing paths are refused. An archive failure latches unhealthy state and prevents further publication.
- Reject non-increasing sequence or decreasing receiver time; count sequence gaps. Reset/wrap needs a new process/journal/session.

The browser fails closed on disconnect and retains its current bounded session. Export it before explicitly reconnecting. Replay is available to compatible API clients but is not automatic recovery in the current UI.

Journals contain normalized validated v2 frames, not byte-for-byte copies of unknown input fields. Partial lines at EOF are not valid frames. Fsync is per frame and may limit throughput; benchmark the target disk/receiver cadence. Disk rotation, retention policy, receiver hardware drivers and long-running service supervision remain commissioning work.
