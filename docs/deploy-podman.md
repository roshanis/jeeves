# Jeeves — Podman deployment

Self-hosted deployment with Podman: the app plus its own Postgres, no Neon and
no Vercel. Companion to [`deploy.md`](./deploy.md), which covers the Vercel +
Neon path.

Everything here also works with Docker (`docker` for `podman`,
`Containerfile` is a Dockerfile) except the Quadlet units, which are
Podman-specific.

> **Verification status, stated plainly.** The image was **not built or run**
> during authoring — this environment blocks container-registry pulls, so the
> base image was unreachable. What *was* verified, against a real PostgreSQL
> 16: the driver fix, `npm run db:migrate` and `npm run db:seed`, the
> standalone build, the standalone server serving every console route with
> real seeded data, and the health endpoint returning 200 / 503 / 200 across a
> database outage. The Quadlet units were validated with Podman's own
> generator. The unverified part is image assembly itself — the `COPY` paths
> and stage wiring. Treat the first `podman build` as the remaining test.

---

## 1. Quick start (compose)

```bash
cd deploy/podman
cp env.example .env          # then edit: set POSTGRES_PASSWORD and DEMO_PASSCODE
podman compose up -d --build
podman compose run --rm migrate      # create the schema
podman compose run --rm seed         # load the synthetic demo data
```

Then open `http://localhost:3000`.

`podman compose` needs a compose provider (Podman 4.7+ shells out to
`docker-compose` or `podman-compose`). If you would rather not have one, use
the Quadlet units in §3 — they are the Podman-native path.

---

## 2. What the stack is

| Service | Image | Notes |
|---|---|---|
| `db` | `postgres:16-alpine` | **Not** published to the host. Data in the `jeeves-pgdata` volume. |
| `app` | built from `Containerfile` (`runner`) | The only published port. Non-root, read-only rootfs. |
| `migrate` / `seed` | built from `Containerfile` (`migrator`) | One-shot jobs, `tools` profile. |

### Why two images

The runtime image ships Next's **standalone output** — the traced set of files
the app actually reaches, about 93 MB including `node_modules`, rather than
the full ~1 GB dependency tree.

The migration scripts cannot run from it. They are TypeScript executed through
`tsx`, `tsx` depends on `esbuild`, and `esbuild` is not in the trace: Next
traces what the *application* imports, and the application never imports a
CLI. An earlier draft of the Containerfile copied `tsx` into the runtime image
and would have failed with a module-not-found on the first migration. The
`migrator` stage keeps the full toolchain for those jobs and leaves the
runtime image lean.

### Why migration is a separate step

The app does **not** migrate on boot. With more than one replica, concurrent
boots race on the same schema; and an automatic migration is exactly the kind
of thing that should be a decision rather than a side effect of a restart.

`npm run db:migrate` is non-destructive and idempotent
(`lib/db/migrate.test.ts`). `npm run db:seed` is **destructive** — it wipes
every seeded table and disables the `audit_events` append-only triggers to
delete the audit log. Run it once on a fresh database and never against
anything you care about.

---

## 3. systemd (Quadlet) — for a machine that should run this at boot

Quadlet is Podman's native systemd integration: you write `.container` files
and systemd generates the units.

```bash
# Build both images first — Quadlet does not build.
podman build -f deploy/podman/Containerfile -t localhost/jeeves:latest .
podman build -f deploy/podman/Containerfile --target migrator \
  -t localhost/jeeves-migrator:latest .

mkdir -p ~/.config/containers/systemd
cp deploy/podman/quadlet/* ~/.config/containers/systemd/
cp deploy/podman/env.example ~/.config/containers/systemd/jeeves.env
chmod 600 ~/.config/containers/systemd/jeeves.env    # it holds both passwords
$EDITOR ~/.config/containers/systemd/jeeves.env

systemctl --user daemon-reload
systemctl --user start jeeves-db
# migrate once, before first app start:
podman run --rm --network jeeves \
  -e DATABASE_URL='postgres://jeeves:PASSWORD@jeeves-db:5432/jeeves' \
  localhost/jeeves-migrator:latest npm run db:migrate
systemctl --user start jeeves-app
```

For a rootless service that should survive logout:
`loginctl enable-linger $USER`.

The app unit runs with `ReadOnly=true`, `DropCapability=ALL` and
`NoNewPrivileges=true`. The read-only rootfs is safe because the server writes
nothing to its own filesystem — verified by watching for writes across
requests to every console route — with `/tmp` mounted as a small tmpfs for
Node's own use. If a future change introduces ISR or on-disk caching, that
assumption needs revisiting.

---

## 4. The database driver — read this if you change `DATABASE_URL`

`lib/db/client.ts` picks a driver from the URL
(`lib/db/driver-select.ts`):

| `DATABASE_URL` host | Driver |
|---|---|
| `*.neon.tech` | `@neondatabase/serverless` (WebSocket) |
| anything else | `pg` (node-postgres) |
| unset | PGlite, local file store |

This matters because the Neon serverless driver does not speak the Postgres
wire protocol — it talks to Neon's WebSocket proxy. Before the split, *any*
`DATABASE_URL` selected it, so pointing the app at a Postgres container failed
like this (measured against a real PostgreSQL 16 at `127.0.0.1:5432`):

```
DrizzleQueryError: Failed query: select 1 as ok
  cause: ErrorEvent - connect ECONNREFUSED 127.0.0.1:443
```

Note the port. It ignored the `:5432` in the URL entirely and dialled 443,
which is a genuinely confusing thing to debug. Any container deploy with a
`postgres` sidecar — including this one — would have hit it.

`JEEVES_DB_DRIVER=neon|pg` forces the choice if you need to (a Neon proxy on a
custom domain, say).

---

## 5. Operations

```bash
podman compose logs -f app
podman compose ps                          # STATUS shows (healthy)
curl -s localhost:3000/api/health          # {"status":"ok","database":"ok"}
```

`GET /api/health` round-trips `select 1`, so a container that is running but
cannot reach Postgres reports unhealthy rather than up — verified by stopping
Postgres under a live server (200 → 503) and restarting it (503 → 200). It is
unauthenticated, so it deliberately returns nothing but a status word: no
version, no hostname, no driver, and no database error text, since connection
errors carry the host and port.

### Backups

The Postgres data lives in a named volume:

```bash
podman volume export jeeves-pgdata --output jeeves-pgdata.tar    # back up
podman volume import jeeves-pgdata jeeves-pgdata.tar             # restore
```

Stop the stack first — exporting a volume under a running Postgres captures a
torn snapshot. For a consistent online backup use `pg_dump` instead:

```bash
podman compose exec db pg_dump -U jeeves jeeves > jeeves-$(date +%F).sql
```

The same caveat as `deploy.md` §4 applies: nobody has restored from one of
these. A backup you have not restored from is a hypothesis.

### Upgrading

```bash
git pull
podman compose build
podman compose run --rm migrate     # only if drizzle/ changed
podman compose up -d
```

---

## 6. What this does not give you

- **Authentication.** Unchanged by containerisation: a shared passcode, and
  the caller picks their own persona, so the named accountable approver is
  self-asserted. See `production-readiness.md` §1.1. Do not put this on a
  public address and treat the approvals as real.
- **TLS.** The app serves plain HTTP on 3000. Put it behind a reverse proxy
  (Caddy, nginx, Traefik) that terminates TLS. The app already sends HSTS,
  which is only meaningful once something is actually serving HTTPS.
- **Horizontal scale.** Sessions, the token budget and the rate-limit buckets
  are all in Postgres, so multiple replicas are *correct* — but nothing here
  sets up a load balancer, and the single published port assumes one app
  container.
- **Secret management.** `.env` on disk, mode 0600 at best. Fine for a
  self-hosted demo, not for anything holding real credentials; use Podman
  secrets or your platform's secret store.
