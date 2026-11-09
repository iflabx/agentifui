# Publishing Code Safely

GitHub contains public code, migrations, configuration templates, default pages and default translations. Real credentials, environment files, model-configuration exports, backups, user uploads and internal notes stay outside Git. Public assets and copy still require a manual diff review: a scanner cannot determine whether every image or paragraph is private.

## Local Configuration, Public Code

Keep deployment-specific domains, service endpoints and branding in private environment files or runtime data, not tracked source constants. Publish safe templates and generic defaults so another installation can configure the same code. Keep reusable development, CI, Docker and deployment tools in Git; local operation does not require editing tracked defaults before and after each push. Tests use fictional values, not an installation's actual identity or credentials. See [configuration](CONFIGURATION.md) for the existing environment loader and public branding overrides.

The push check rejects violations; it does not sanitize, replace or delete local configuration. Hooks can be bypassed, and CI normally runs after upload, so neither replaces file separation and staged-diff review. GitHub push protection, where available and enabled, is an additional ingress check for supported secret patterns, not a detector for all private information.

Docker build contexts have a separate boundary: `.dockerignore` excludes actual environment files, private tools, credentials, runtime data and old build outputs while keeping public templates and source defaults. Git ignore rules alone do not protect a `COPY . .` build. Supply public build variables explicitly when building for a deployment; Compose `env_file` supplies container runtime variables, not build inputs. Never send secrets as public build arguments or publish a local working-directory archive as a release.

## One Check, Two Gates

Install Gitleaks **8.24.3** on the development host's PATH using the upstream release and verify its published SHA-256. Run the existing dependency installation to activate Husky (`core.hooksPath=.husky/_`). The project's `.husky/pre-push` invokes `scripts/check-publication.mjs`; CI uses that same checker, including document-only changes. Push never downloads a scanner or builds the application. A missing or incompatible scanner fails the check.

The publication integration tests also require this scanner on PATH. CI installs it separately in the test runner through the shared action's `install-only` input; the independent publication job still runs the full check.

The checker rejects private paths in the outgoing tree and paths introduced in outgoing commits. Gitleaks scans the commit range, including secrets added and subsequently deleted. New branches or unavailable bases use a broader secret scan. Deleting a ref adds no content. Scan output is redacted; do not paste raw credentials into issues or reports.

To verify a known range without pushing:

```bash
node scripts/check-publication.mjs --base <FULL_BASE_SHA> --head <FULL_HEAD_SHA>
```

For a first historical audit, `--all` scans reachable history and checks the current HEAD tree. This audits committed objects, not uncommitted files. Before committing, inspect the actual staged diff; after committing, run the range check or normal push hook. Git ignores do not remove already tracked files or protect secrets embedded in allowed files.

Review false positives individually. Allow only a specific fake value, rule or historical fingerprint with a documented reason; do not exempt all tests, JSON, SQL or documentation. Rotate real exposed credentials before deciding whether historical cleanup is necessary. Do not bypass a failed check or rewrite shared history automatically.

The shared checker explicitly loads `.gitleaksignore` from the project alongside its scanner configuration. It contains only individually reviewed historical fingerprints with reasons; a new occurrence is not exempt. Unresolved findings remain blocking, even when the current source tree is clean.

## Version Handoff

After CI and Stage acceptance, merge through the release PR, verify the final main tree and publish an annotated tag. Hand the tag, full main commit and acceptance summary to the production operator. Deployment runs locally on the production server from that version; source-package delivery is only a fallback when direct GitHub access is unavailable. See [deployment](QUICK-DEPLOYMENT.md).

Only production-owned configuration and data are used there. Never synchronize a complete development directory into production or include environment files in a source archive. `NEXT_PUBLIC_*` values are public build inputs, not secret storage. Database-encrypted credentials remain sensitive; preserve the production encryption key during upgrades.
