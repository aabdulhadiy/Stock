# Operations runbook

Everything an operator needs for the Warehouse & Sales system: deploy, update,
roll back, restore, and look at logs. Required by §16.3.

The system runs as four Docker containers on one VPS (§16): `app`, `db`,
`nginx`, `certbot`, plus a `backup` sidecar. All persistent state lives on named
volumes, so containers can be rebuilt freely.

---

## 1. First deployment

**You need:** a VPS with 2 vCPU / 4 GB RAM / 40+ GB SSD running Ubuntu LTS,
Docker and the Compose plugin, and a domain pointed at the server's IP.

```bash
git clone <repository> /opt/warehouse && cd /opt/warehouse

cp .env.example .env
nano .env
```

Set at minimum:

| Variable | What to put there |
|---|---|
| `POSTGRES_PASSWORD` | A long random string. Generate: `openssl rand -base64 24` |
| `AUTH_SECRET` | A long random string, 32+ characters. `openssl rand -base64 48` |
| `APP_DOMAIN` | The domain, e.g. `warehouse.example.uz` |
| `SEED_DIRECTOR_PASSWORD` | The first Director's password — change it after signing in |
| `BACKUP_OFFSITE_DIR` | A path on a **second disk or a remote share** (§14) |

Then:

```bash
docker compose up -d --build      # builds the image and starts everything
docker compose ps                 # all services should be "running"/"healthy"
```

Create the first Director and the reference data (once only):

```bash
docker compose exec app node -e "process.exit(0)"   # confirm the app container runs
docker compose run --rm -e NODE_ENV=production app sh -c "npx tsx src/db/seed.ts"
```

The seed is idempotent — running it twice creates nothing new. It refuses to
create a Director with the default password when `NODE_ENV=production`, so
`SEED_DIRECTOR_PASSWORD` must be set.

Open `http://<domain>` and sign in. Then set up HTTPS (§14 requires it).

---

## 2. HTTPS

The nginx config ships proxying plain HTTP so the server is reachable
immediately and certbot can complete its challenge. Issue the certificate, then
switch nginx to HTTPS-only.

```bash
# 1. Issue the certificate (replace the address).
docker compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d "$APP_DOMAIN" --email admin@example.uz \
  --agree-tos --no-eff-email

# 2. Turn on HTTPS: in deploy/nginx.conf.template, comment out the plain
#    `location /` proxy block, uncomment the `return 301 https://...` redirect,
#    and uncomment the whole `server { listen 443 ssl; ... }` block.
nano deploy/nginx.conf.template

# 3. Apply.
docker compose restart nginx
curl -I "https://$APP_DOMAIN"      # expect 200 or a redirect to /login
```

Renewal is automatic: the `certbot` service checks every 12 hours and renews
when a certificate is within 30 days of expiry. nginx picks up the new file on
its next restart, so reload it monthly (or add
`docker compose exec nginx nginx -s reload` to a cron entry).

---

## 3. Updating to a new version

```bash
cd /opt/warehouse

bash scripts/backup.sh            # always back up before an update
git pull
docker compose build app
docker compose up -d app          # replaces the container; db/nginx untouched

docker compose logs -f app        # watch it migrate and start
```

Database migrations run automatically on container start
(`scripts/docker-entrypoint.sh` → `scripts/migrate.mjs`) before the server
accepts traffic. A failed migration stops the boot, so a broken schema change
never serves requests.

Expect a few seconds of downtime while the container restarts.

---

## 4. Rolling back

Rollback is starting the previous image (§16.2). Tag before you build, so there
is always something to go back to:

```bash
# Before updating:
docker compose build app
docker image tag warehouse-app:latest warehouse-app:$(date +%Y%m%d)

# To roll back:
docker image tag warehouse-app:20260729 warehouse-app:latest
docker compose up -d app
```

**A caveat worth understanding:** rolling the *application* back does not roll
the *database* back. If the version you are leaving added a migration, the
schema keeps that change. Additive migrations (new tables and nullable columns)
are safe to leave in place; if a migration removed or renamed something, restore
the pre-update backup as well — see below.

---

## 5. Backup and restore

### What runs automatically

The `backup` service takes one `pg_dump` immediately on start and then daily at
`BACKUP_HOUR` (default 02:00 UTC). Each dump is written to the `backups` volume
and copied to `BACKUP_OFFSITE_DIR`. Dumps older than
`BACKUP_RETENTION_DAYS` (default 30, §14's minimum) are pruned — but only after
a successful dump, so a run of failures cannot age out the last good backup.

```bash
docker compose logs backup                       # schedule and results
docker compose exec backup ls -lht /backups      # what exists
```

### Taking one now

```bash
bash scripts/backup.sh
```

### Restoring

```bash
bash scripts/restore.sh                          # list available backups
bash scripts/restore.sh stockdb-20260729-020000Z.dump
```

The script stops the app, dumps the current state to a `pre-restore-*.dump`
first, restores, restarts the app, and waits for the health check. It asks you
to type `RESTORE` before doing anything destructive.

`pg_restore` prints `... does not exist, skipping` notices when restoring into an
empty database. Those are normal and not errors.

**Uploads are not in the database.** Product images and expense receipts live in
the `uploads` volume. Back that up too:

```bash
docker run --rm -v warehouse_uploads:/data -v "$PWD/var:/out" alpine \
  tar czf /out/uploads-$(date -u +%Y%m%d).tar.gz -C /data .
```

(Replace `warehouse_uploads` with the real volume name from `docker volume ls`.)

### Practising a restore

Do this at least once, and at acceptance (§16.3). It is the only way to know the
backups are real:

```bash
bash scripts/backup.sh
# Note a figure you can recognise — say the product count on the Stock screen.
bash scripts/restore.sh <that backup>
# Sign in and confirm the figure is unchanged.
```

---

## 6. Logs and health

```bash
docker compose logs -f app          # application
docker compose logs -f nginx        # requests and TLS
docker compose logs -f db           # PostgreSQL
docker compose logs backup          # backup schedule

docker compose ps                   # health status of each service
curl -s localhost/api/health        # {"ok":true}
```

The app logs unexpected errors with a stack trace. Expected problems (a wrong
password, a validation failure, a shortfall on acceptance) are returned to the
user and not logged as errors, so anything in the log is worth reading.

---

## 7. Common problems

**The app container restarts in a loop.**
Look at `docker compose logs app`. Usually `AUTH_SECRET` is missing or shorter
than 32 characters, or `DATABASE_URL` is wrong — both fail fast on purpose.

**"AUTH_SECRET must be at least 32 characters long".**
Exactly what it says. Generate one with `openssl rand -base64 48`. Changing it
signs everyone out, which is harmless.

**A user cannot sign in and the password is definitely right.**
Check the account is active (Users screen), and — for a Salesperson — that the
Salesperson role is enabled in Settings. It is off by default (§2.1), and a
disabled role cannot sign in.

**PDF exports show blank squares instead of Russian text.**
The DejaVu fonts are missing from the image. `docker compose exec app ls
assets/fonts` should list `DejaVuSans.ttf` and `DejaVuSans-Bold.ttf`. Rebuild
with `docker compose build --no-cache app` if not.

**Stock figures look wrong.**
On-hand is the sum of the movement ledger, and the cached figure is always
rebuildable from it. Check for drift:

```bash
docker compose exec db psql -U stock -d stockdb -c "
  SELECT ps.product_id, ps.on_hand AS cached,
         COALESCE(SUM(m.qty_units), 0) AS ledger
    FROM product_stock ps
    LEFT JOIN stock_movements m ON m.product_id = ps.product_id
   GROUP BY ps.product_id, ps.on_hand
  HAVING ps.on_hand <> COALESCE(SUM(m.qty_units), 0);
"
```

An empty result means there is no drift. If rows come back, that is a bug worth
reporting — the ledger is authoritative, and `recomputeStock()` in
`src/lib/stock.ts` rebuilds the cache from it.

**Disk filling up.**
Old backups and Docker build layers are the usual culprits:

```bash
df -h
docker system df
docker image prune -a          # removes images not used by a container
```

Keep at least the previous application image so a rollback stays possible.

---

## 8. What is where

| Path | Contents |
|---|---|
| `docker-compose.yml` | Service definitions |
| `.env` | Secrets and settings (never committed) |
| `deploy/nginx.conf.template` | Reverse proxy and TLS configuration |
| `scripts/backup.sh` | Take a backup now |
| `scripts/backup-loop.sh` | The daily schedule inside the backup container |
| `scripts/restore.sh` | Restore from a backup |
| `scripts/migrate.mjs` | Applies migrations on container start |
| `drizzle/` | Migration SQL |
| Volume `pgdata` | The database |
| Volume `uploads` | Product images, expense receipts |
| Volume `backups` | Daily dumps |
| Volume `certbot-conf` | TLS certificates |
