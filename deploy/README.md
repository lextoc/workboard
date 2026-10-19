# GitHub delivery

The Delivery workflow runs on pull requests, pushes to `main`, and manual requests from the Actions tab. Pull requests receive checks without production secrets. Successful `main` builds upload a 14-day GitHub artifact and deploy that exact archive through the GitHub `production` environment. Production deployments are serialized without cancelling a running deployment, and a job refuses to deploy if its commit is no longer the latest `main` revision.

## Activation

From the repository root, the administrative configurator is:

```sh
python3 deploy/configure-github.py
```

It requires Python 3, OpenSSH, an authenticated GitHub CLI with repository administration and Actions-secret permissions, and existing trusted root SSH access to `alexanderclaes.be`. It makes these persistent changes:

- Creates a GitHub `production` environment restricted to the `main` branch, with `DEPLOY_HOST` and `DEPLOY_USER` variables.
- Generates a dedicated Ed25519 deployment key. Stores the private key as `DEPLOY_SSH_KEY` and the verified server host key as `DEPLOY_KNOWN_HOSTS` environment secrets. The temporary local private-key file is removed when setup exits.
- Generates a dedicated random application email/password for automation. Stores `SMOKE_EMAIL` and `SMOKE_PASSWORD` as environment secrets and `{email, password}` in root-only `/etc/workboard/deploy-smoke.json`. The server-side verifier registers this account if missing, then logs in. It has its own private board and cannot read the owner’s data. No nginx password file is changed. Rotating setup credentials uses a new account email; old automation accounts are not automatically deleted.
- Creates the `workboard-deploy` SSH account with a root-owned authorized-key file. The key permits only the `check` command or a validated `deploy COMMIT-RUN-ATTEMPT SHA256` command. Interactive shells, arbitrary commands, forwarding, and PTYs are disabled for this key.
- Installs root-owned `workboard-deploy-ssh`, `workboard-deploy`, and `/usr/local/libexec/workboard-smoke` entry points and a sudo rule allowing only that deployment executable. The executable independently validates its arguments and archive contents. Application files run as the existing unprivileged `workboard` service user.
- Protects `main`, including for administrators: pull requests, an up-to-date branch, the passing `Build, test and package` check, and resolved conversations are required. No approving reviewer is required, so a solo owner can merge their own pull request. Force pushes and branch deletion are disabled.
- Tests the new SSH connection, rejection of arbitrary shell commands, and rejection of a corrupt deployment upload. It does not restart the application or deploy a release during setup.

Review [the configurator](configure-github.py), [server installer](install-deploy.py), [SSH entry point](workboard-deploy-ssh), [deployment executable](workboard-deploy), and [sudo rule](workboard-deploy.sudoers) before administrative installation. Setup is not transactional: a failure can leave earlier steps applied. Running it again rotates both automation credentials and replaces the dedicated account's authorized key, so do not run it during a deployment. It also applies the documented branch protection settings.

After configuration, commit the delivery files on a feature branch, push the branch, and open a pull request. Wait for its checks, then merge it. The merge triggers the first production deployment. Configuration alone does not publish uncommitted workflow files. To retry a release, rerun the workflow in GitHub; each attempt gets a different release directory. A manual workflow request must select `main` and builds its current commit rather than selecting an arbitrary old artifact.

## What a release does

1. Builds on Java 21, runs the H2 API suite and deployment tests, and runs the frontend browser suite with Node.js 24 and pinned Playwright tooling installed outside the application. It then exercises the packaged application against PostgreSQL 16, including reuse of the first session after a restart against the migrated database. The disposable API exercise creates an empty project, assigns a ticket, checks deletion conflicts, renames the project, preserves and changes the assignment through ticket updates, and cleans up the ticket before the project, including on failure.
2. Uploads the full Quarkus fast-jar archive over restricted SSH. The server verifies its SHA-256 checksum, rejects traversal paths, links, special files, duplicate paths and oversized archives, and stages root-owned files outside the active release.
3. Takes a database backup through the existing `workboard-backup.service`. Backup failure leaves the active release untouched.
4. Saves release metadata, atomically switches `/opt/workboard/current`, and restarts `workboard.service`. A short interruption is expected.
5. Waits for local database readiness and a protected API challenge, then runs the installed smoke client through HTTPS. It ensures the dedicated automation account exists, logs in, checks public assets, public health denial, anonymous API rejection, authenticated lists, logout, and rejection of the revoked session. GitHub repeats these HTTPS checks with `SMOKE_EMAIL`/`SMOKE_PASSWORD`. Checks create/revoke sessions but do not create or change production tickets/projects. Account bootstrap is restricted to the explicitly requested server-side `--ensure-account` step; the external workflow only logs in. The updated helper and smoke executable require administrative reinstallation before this release.
6. Reports the result in GitHub Actions and the environment deployment history. Release metadata is saved in `/opt/workboard/current/.release.json`.

The normal workflow cannot install new privileged server helpers, alter nginx configuration, or update systemd units. Those changes require administrative installation. Database credentials remain in `/etc/workboard/workboard.env`; they are not sent to GitHub. The SSH host key is pinned from the already trusted administrative connection, not accepted from an unauthenticated key scan during deployment. Official GitHub Actions are pinned by commit; Dependabot proposes weekly action updates.

Production credentials are supplied through encrypted environment secrets, never committed or included in the application archive. Only the deployment job on `main` references the production environment. Pull-request jobs have no production credentials. The workflow does not echo secrets or enable shell tracing, and the deployment helper keeps production application logs in the server journal rather than printing them into public Actions logs. Changes to workflow code on `main` can access deployment secrets, so merge only trusted changes. The hardcoded PostgreSQL credentials in the verification job belong only to its disposable CI database.

## Failures and recovery

If startup or the server-side HTTPS checks fail and the packaged migration resources are identical to the previous release, the server switches back to the previous application and verifies it. The GitHub deployment still fails so the regression is visible. Matching migration files are a conservative check for the current Flyway-only schema-management model, not a guarantee against arbitrary data changes introduced by future application code.

If migration resources changed, the server stops the failed new application and leaves its release selected for investigation. It does not roll application files or database state back automatically. Inspect Flyway history and the failure before choosing a forward fix or an application/database restore. A database restore can discard writes made since the backup and must be an explicit recovery decision.

```sh
ssh root@alexanderclaes.be
journalctl -u workboard.service -n 100 --no-pager
cat /opt/workboard/current/.release.json
systemctl status workboard-backup.service
```

An external GitHub connectivity failure can mark a deployment failed even after server-side verification succeeds. Inspect the selected release before taking recovery action. Releases are retained on the droplet for investigation and rollback; monitor disk usage and remove obsolete releases administratively while preserving the current release and its predecessor. GitHub artifact expiration does not delete server releases.

Backups remain on the same droplet and no restore drill has been verified. Off-server backup storage and restore testing remain separate outstanding work.

## Verification before activation

```sh
./mvnw --batch-mode --no-transfer-progress clean verify -DargLine=
python3 -m unittest discover -s deploy/tests -v
actionlint .github/workflows/delivery.yml
```

CI pins Playwright 1.62.1 and installs it under the runner’s temporary directory, then installs Chromium and its Linux dependencies. No frontend runtime dependency is added to the application. Locally, run `node --test src/test/frontend/projects.test.cjs` with Playwright on `NODE_PATH` and, if needed, `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` pointing to an installed Chromium. The browser tests use mocked APIs; the packaged PostgreSQL exercise checks the real HTTP API separately.

For an already started disposable production-profile application backed by PostgreSQL:

```sh
python3 deploy/smoke-test.py http://127.0.0.1:18084 --exercise-api
```

`--exercise-api` registers an isolated test account (or uses supplied smoke credentials), writes a temporary project and ticket, and is intended for a disposable database. It cleans up the ticket before the project and attempts project cleanup even if ticket cleanup fails. Test accounts remain in the disposable database. Public production verification uses `--check-auth` with `SMOKE_EMAIL` and `SMOKE_PASSWORD`; it creates/revokes sessions but does not change board data. The flags are mutually exclusive.

For local HTTP with a production-profile package, explicitly set `APP_AUTH_COOKIE_NAME=workboard-session`, `APP_AUTH_COOKIE_SECURE=false`, and `APP_AUTH_ALLOWED_ORIGIN=http://127.0.0.1:18084`. Never use the HTTP cookie overrides on the public server. `--origin` can override the smoke client's Origin for a proxy setup.

`--session-file PATH --keep-session` saves a restricted cookie file after a successful disposable exercise. After restarting the app, `--session-file PATH --reuse-session` requires that session to remain valid, exercises the API, logs out, verifies the copied token is rejected, and removes the file. The workflow uses this sequence. Cookie files contain live credentials; keep them out of logs and release archives.

## One-time user-auth cutover

This repository change does not reset or deploy production. Before activating it:

1. Verify the new artifact and tests. Install the updated root-owned deployment helpers and smoke executable, and provision the new `SMOKE_EMAIL`/`SMOKE_PASSWORD` environment secrets plus matching root-only `{email,password}` credentials file. The updated configurator performs this administrative setup but also rotates the deployment key; review its full effects first. Old `SMOKE_USERNAME`/nginx credentials cannot authenticate to the application.
2. In the maintenance window, stop the old application and take a database backup. Recreate the dedicated database with the existing database role as owner, preserving the configured JDBC URL and credentials. V3 intentionally assumes empty ticket/project tables. Keep the old application stopped so it cannot recreate/populate the database before the new release.
3. Install `workboard.nginx.conf` in the existing nginx site (included from the `http` context), run `nginx -t`, and reload nginx as part of the cutover. This removes the Basic gate, opens the login/signup page, denies public `/q/`, and applies per-IP login/signup limits. Do not expose the old unauthenticated backend by removing the gate early.
4. Deploy the verified new artifact. Its first startup applies V1/V2/V3; the updated root verifier bootstraps its dedicated application account and verifies session authentication over HTTPS. Confirm signup/login and a private board before ending maintenance.

The automatic workflow does not install helpers/nginx or reset databases. The new verifier expects the new session-based application; do not mix it with the old release's Basic-auth smoke assumptions. Migration-changing releases still disable automatic rollback. No production cutover has been performed by this task.
