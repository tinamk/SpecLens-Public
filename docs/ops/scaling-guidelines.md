# Scaling Guidelines

## API

- Keep `API_MAX_CONCURRENT_ANALYSES` low for each API instance to avoid starving DB/queue connections.
- Scale API horizontally; queue dispatch is lease-based and safe across instances.
- Use `/metrics` for request volume and queue depth.

## Runner

- Set `RUNNER_MAX_CONCURRENCY` per node based on CPU/memory and sandbox limits.
- Scale runners horizontally; each runner claims jobs via `pg-boss`.
- Consider one runner per host for strict sandbox isolation.

## Queue

- `pg-boss` handles multi-node workers. Track backlog via `speclens_queue_depth`.
- If pending jobs grow, increase runner pool or reduce analysis concurrency in API.
