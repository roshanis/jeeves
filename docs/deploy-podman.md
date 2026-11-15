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
cp env.example .env          # then edit: set POSTGRES_PASSWORD and JEEVES_COOKIE_SECRET
podman compose --profile tools build   # the app and the migrate/seed image
podman compose run --rm migrate      # create the schema, before the app takes traffic
podman compose run --rm seed         # load the synthetic demo data
podman compose up -d
```

Then open `http://localhost:3000`.

Open it as `localhost` (or over HTTPS). The app marks its workspace cookie
`Secure` because the image runs with `NODE_ENV=production`, and browsers drop a
`Secure` cookie over plain HTTP from any other address, such as
`http://192.168.1.20:3000`. The pages then show only the seeded rows and a
visitor's own initiatives are missing.

`OPERATOR_TOKEN` in `.env` (32+ characters, `openssl rand -hex 32`) is optional.
It opens the "Send a real request" door and the `/operator` queue that reads
those requests. While it is unset the door is closed: visitors are not offered
it, because nobody could read what they sent. The Quadlet units pick it up from
`jeeves.env` the same way.

`podman compose` needs a compose provider (Podman 4.7+ shells out to
`docker-compose` or `podman-compose`). If you would rather not have one, use
the Quadlet units in §3 — they are the Podman-native path.

---

## 2. What the stack is

| Service | Image | Notes |
|---|---|---|
| `db` | `postgres:16-alpine` | **Not** published to the host. Data in the `jeeves-pgdata` volume (`podman_jeeves-pgdata` on the host). |
| `app` | built from `Containerfile` (`runner`) | The only published port. Non-root, read-only rootfs. |
| `migrate` / `seed` | built from `Containerfile` (`migrator`) | One-shot jobs, `tools` profile. |

### The image carries no source tree

The runtime image is exactly `.next/standalone`, so that directory must hold
only the traced server, the agent prompts (`agents/**/*.md`) and the policy
corpus (`docs/policies/**/*.md`). A Turbopack file-tracing regression once
shipped the whole repository (tests, scripts, planning notes) next to
`server.js`. The builder stage now runs `node scripts/check-standalone-output.cjs`
right after `npm run build` and fails the image build if anything else is
there. To run it by hand: `npm run build`, then
`node scripts/check-standalone-output.cjs [path/to/.next/standalone]`.

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
chmod 600 ~/.config/containers/systemd/jeeves.env    # it holds the database password and the cookie key
# env.example has no DATABASE_URL (compose builds it inline; Quadlet cannot), so add
# this line to jeeves.env while you edit it, with the same password as POSTGRES_PASSWORD:
#   DATABASE_URL=postgres://jeeves:PASSWORD@jeeves-db:5432/jeeves
# Without it the app falls back to a local PGlite store, which the read-only root
# filesystem refuses: the app runs without a database, its data pages fail and
# the health check reports unhealthy.
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

The Postgres data lives in a named volume. Compose prefixes the volume with
the project name, which defaults to the directory name, so from
`deploy/podman` it is `podman_jeeves-pgdata` (check with `podman volume ls`).
The Quadlet path names it `jeeves-db`.

```bash
podman volume export podman_jeeves-pgdata --output jeeves-pgdata.tar    # back up
podman volume import podman_jeeves-pgdata jeeves-pgdata.tar             # restore
```

Stop the stack first — exporting a volume under a running Postgres captures a
torn snapshot. For a consistent online backup use `pg_dump` instead:

```bash
podman compose exec db pg_dump -U jeeves jeeves > jeeves-$(date +%F).sql
```

Restore into a fresh database rather than over the running one, and run the
post-restore checks: see `deploy.md` §4. The same caveat applies: nobody has
restored from one of these. A backup you have not restored from is a hypothesis.

### Stopping during a draft run

Draft runs execute inside the HTTP request. One run may take up to 60 s, or
120 s with deep review (`JEEVES_DEEP_REVIEW=1`). Podman sends SIGKILL 10 s
after the stop signal by default, which cuts a live run off. Give the app
longer than one run: `podman compose stop -t 130 app` (and `up -d -t 130`
when an upgrade replaces the container) for compose, and for Quadlet a drop-in
`~/.config/containers/systemd/jeeves-app.container.d/stop.conf` containing
`[Container]` and `StopTimeout=130`. The server stops as soon as its open
requests finish, so the longer limit costs nothing when nothing is running.

### Upgrading

```bash
git pull
podman compose --profile tools build   # rebuilds the migrator, so migrate sees the new drizzle/
podman compose run --rm migrate        # only if drizzle/ changed
podman compose up -d -t 130            # lets a running draft finish
```

**Upgrading an older `.env`.** The compose stack now requires a non-empty
`JEEVES_COOKIE_SECRET`, and `DEMO_PASSCODE` is gone from the template. A `.env`
that only sets `DEMO_PASSCODE` makes `podman compose` stop with a clear error.
Set `JEEVES_COOKIE_SECRET` instead, for example with `openssl rand -hex 32`.

The new secret is not the old derived one. The app signs the workspace cookie
with `JEEVES_COOKIE_SECRET` whenever it is set, and a cookie signed under the
previous `DEMO_PASSCODE`-derived secret no longer verifies. On read requests
such a cookie is treated as no workspace, so a returning visitor sees only the
seeded data until they get a new cookie.

---

## 6. What this does not give you

- **Authentication.** Unchanged by containerisation: there is no sign-in
  (visitors get any persona passwordlessly in their own workspace), and
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
