# Design Contract MCP

A contract-first design-to-code architecture demo that consumes a vendored `@hugo-ui/mui` AI contract snapshot.

This repository is the contract consumer side of a two-repository demo:

- [`hugo-ui`](https://github.com/HugoHZXu/hugo-ui) publishes a versioned `@hugo-ui/mui` AI contract artifact through GitHub Releases.
- Design Contract MCP vendors that artifact snapshot and exposes it through MCP tools, a context pack, a validator, and a focused demo UI.

## What This Is

This project shows AI application/tooling patterns:

1. A local Figma MCP-shaped tool-result fixture.
2. Normalized Figma-like design data derived from MCP context.
3. Contract-enriched Code Connect mapping metadata.
4. A vendored design-system AI contract snapshot from `@hugo-ui/mui`.
5. A thin MCP server exposing design and codegen context.
6. A validator for generated React component usage.
7. A simple three-column demo UI showing the chain.

## What This Is Not

- It is not a complete Figma-to-code product.
- It does not connect to the live Figma MCP server or Figma API.
- It does not publish or integrate with official Figma Code Connect.
- It does not support arbitrary Figma files.
- It does not attempt production-grade design fidelity.
- It does not call business APIs.
- It does not call an LLM inside the MCP server.
- It does not require `@hugo-ui/mui` as a runtime npm dependency for the preview UI.
- It is not a public internet-facing MCP SaaS product.
- It does not implement multi-tenant auth, billing, quota, audit retention, or enterprise policy integrations.
- It expects remote deployments to run inside a controlled internal network, an allowlisted cloud service, or an enterprise gateway.

## Architecture

```text
hugo-ui GitHub Release artifact
  hugo-ui-mui-ai-contract-v<version>.tgz + .sha256
        |
        v
vendor/hugo-ui/mui-ai-contract/
  reproducible vendored snapshot
        |
        v
fixtures/figma/mcp/
  local Figma MCP-shaped tool-result fixture
        |
        v
scripts/normalize-figma-fixture.ts
  deterministic fixture normalization
        |
        v
fixtures/figma/
  normalized local design frame data
        |
        v
code-connect/manifest.json
  contract-enriched Code Connect node-to-component mapping
        |
        v
mcp-server/
  thin local context server, contract adapter, and validator
        |
        v
generated/edit-profile-modal.context-pack.json
  resolved design, mapping, real contracts, tokens, pattern, expected usage
        |
        v
generated/
  generated React samples
        |
        v
validator
  import, prop, coverage, forbidden prop, and raw color checks
        |
        v
demo-app/
  three-column visualization
```

The demo UI renders:

- left: design tree,
- middle: resolved mapping and component contract,
- right: generated code and validation report.

The preview shim at `demo-app/src/hugo-ui-preview.tsx` is only for local visualization. Validation uses the real `@hugo-ui/mui` AI contract snapshot from the committed vendor fallback or a locally cached GitHub Release artifact.

For a high-level comparison between this MVP and a real internal product, see `docs/mvp-to-product.md`.

## Install

```bash
npm install
```

## Recommended Local Flow

```bash
npm run contract:verify:hugo-ui
npm run figma:normalize
npm run context:pack
npm run audit:generated
npm run validate
npm run validate:bad
npm run dev
```

Vite will print a local URL, usually `http://localhost:5173`.

## Manage hugo-ui Contract Versions

The committed vendor snapshot under `vendor/hugo-ui/mui-ai-contract/` is a reproducible fallback. Runtime tools can also read release artifacts unpacked into `.cache/hugo-ui/mui-ai-contract/<version>/`.

Check the local contract store:

```bash
npm run contract:status:hugo-ui
```

List published `mui-ai-contract-v*` releases from `HugoHZXu/hugo-ui`:

```bash
npm run contract:list:hugo-ui
```

Sync a contract artifact into the local cache. `installed` reads the local `@hugo-ui/mui` package version and chooses the newest contract release whose version is less than or equal to that package version:

```bash
npm run contract:sync:hugo-ui -- --version installed
```

Other supported selectors:

```bash
npm run contract:sync:hugo-ui -- --version latest
npm run contract:sync:hugo-ui -- --version 1.0.2
npm run contract:sync:hugo-ui -- --tag mui-ai-contract-v1.0.2
```

The script downloads `hugo-ui-mui-ai-contract-v<version>.tgz`, downloads and verifies the matching `.tgz.sha256`, extracts the snapshot into `.cache/hugo-ui/mui-ai-contract/<version>/`, verifies required files, and checks `provenance.json`.

The sync flow requires the release tag, artifact filename, and `provenance.contractVersion` to agree. For example, `mui-ai-contract-v<version>` must contain `hugo-ui-mui-ai-contract-v<version>.tgz`, and the extracted provenance must report `contractVersion: "<version>"`.

For local release-development work, the script can also consume an already downloaded artifact:

```bash
npm run contract:sync:hugo-ui -- \
  --from-file /path/to/hugo-ui-mui-ai-contract-v<version>.tgz
```

This local mode is a convenience only. Public docs and reproducible setup should use GitHub Releases.

Use `HUGO_UI_CONTRACT_VERSION` to select the default runtime contract source. Supported values are `vendor`, `latest`, `installed`, or a semver target such as `1.0.2`. Runtime generation does not contact GitHub; it resolves against the committed vendor snapshot and local cache only.

## Run The MCP Server Over stdio

```bash
npm run mcp:server
```

Use this command for manual local debugging. When configuring a real local MCP client, start the server process directly instead of going through `npm run`:

```bash
./node_modules/.bin/tsx mcp-server/src/server.ts
```

The stdio server exposes local JSON-backed tools only:

- `get_design_context(frameId)`
- `get_code_connect_map(nodeId)`
- `get_component_contract(componentName, contractVersion?)`
- `build_generation_context(frameId, contractVersion?)`
- `validate_generated_code(code, expectedComponentUsage, contractVersion?)`
- `get_contract_status()`

The MCP server reads local fixture files, mapping metadata, cached or vendored contract files, and pattern contracts. It does not call an LLM.

## Run The MCP Server Over Streamable HTTP

```bash
npm run mcp:http
```

The HTTP entrypoint listens on `127.0.0.1:3000` by default and exposes:

- `POST /mcp` for MCP Streamable HTTP,
- `GET /healthz` for a small health check.

Configuration:

```bash
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_PORT=3000
MCP_ALLOWED_HOSTS=localhost,127.0.0.1
MCP_ALLOWED_ORIGINS=http://localhost:3000
HUGO_UI_CONTRACT_VERSION=latest
HUGO_UI_CONTRACT_SYNC=startup
MCP_AUTH_MODE=external
MCP_AUTH_PROVIDER=cloud-platform
MCP_AUTH_CONTEXT_HEADERS=x-authenticated-user-email,x-authenticated-user-id
MCP_LOG_LEVEL=info
```

For most internal deployments, terminate TLS and enforce authentication at the platform, load balancer, or reverse proxy and forward to the Node process over HTTP. `MCP_AUTH_MODE=external` records that authentication is handled upstream; the MCP process does not validate bearer tokens or store auth secrets. `MCP_ALLOWED_HOSTS` limits accepted host headers, and `MCP_ALLOWED_ORIGINS` limits browser-origin requests when an `Origin` header is present. Requests without an `Origin` header are allowed because many MCP clients are not browsers. `HUGO_UI_CONTRACT_SYNC=startup` performs one GitHub Release sync when the process starts; normal MCP requests still read only from the local cache.

## Run The MCP Server With Node HTTPS

The repository also includes a Node HTTPS entrypoint for environments where this process must terminate TLS itself:

```bash
npm run mcp:https
```

Required certificate configuration:

```bash
MCP_HTTPS_KEY_FILE=/path/to/server.key
MCP_HTTPS_CERT_FILE=/path/to/server.crt
MCP_HTTPS_HOST=127.0.0.1
MCP_HTTPS_PORT=3443
```

Certificate material can come from raw environment variables, Base64 environment variables, or file paths supplied by the deployment platform:

```bash
MCP_HTTPS_KEY="-----BEGIN PRIVATE KEY-----..."
MCP_HTTPS_CERT="-----BEGIN CERTIFICATE-----..."
MCP_HTTPS_KEY_BASE64=...
MCP_HTTPS_CERT_BASE64=...
MCP_HTTPS_KEY_FILE=/path/to/server.key
MCP_HTTPS_CERT_FILE=/path/to/server.crt
MCP_HTTPS_CA="-----BEGIN CERTIFICATE-----..."
MCP_HTTPS_CA_FILE=/path/to/ca.crt
MCP_HTTPS_CA_BASE64=...
MCP_HTTPS_PASSPHRASE=...
```

The HTTPS entrypoint uses the same MCP request handler, cache resolver, health check, logging, host validation, and auth modes as the HTTP entrypoint. `MCP_AUTH_MODE=external` is the intended cloud deployment mode when gateway, SSO, IAM, or an allowlist service already rejects unauthenticated requests before they reach this process. `MCP_AUTH_MODE=placeholder` remains available only as a demo marker for a future in-process auth branch; it intentionally allows requests.

MCP logs are written to stderr as JSON lines. Supported `MCP_LOG_LEVEL` values are `debug`, `info`, `warn`, `error`, and `silent`. Logs include HTTP startup configuration, request ID, method, URL, status code, duration, host, remote address, MCP tool name, tool duration, contract selector resolution, validation pass/fail summary, and errors. Request bodies, generated code, and full MCP payloads are not logged.

## Run The Same Tools Locally

Normalize the Figma MCP-shaped tool-result fixture into the smaller fixture shape consumed by this server:

```bash
npm run figma:normalize
```

Generate the context pack used by the demo UI and validator:

```bash
npm run context:pack
```

`npm run context:pack` runs `npm run figma:normalize` first so the committed normalized fixture stays derived from the MCP-shaped capture fixture.

Build generation context:

```bash
npm run mcp:context
```

Build generation context against a selected contract version:

```bash
./node_modules/.bin/tsx mcp-server/src/local-cli.ts \
  build-generation-context frame-edit-profile \
  --contract-version latest
```

Read design context:

```bash
npm run mcp:design
```

Validate the passing generated sample:

```bash
npm run validate
```

Validate an intentionally failing generated sample:

```bash
npm run validate:bad
```

`npm run validate` asserts the sample is valid. `npm run validate:bad` asserts the invalid sample remains invalid, so CI fails if the negative sample accidentally starts passing.

Audit a captured Codex MCP run candidate:

```bash
npm run audit:generated
```

This validates `generated/edit-profile-modal.mcp-run.generated.jsx` against the current context pack, records SHA-256 hashes for the candidate and context pack, and compares the candidate against the committed static samples. The deterministic report is written to `generated/edit-profile-modal.audit-report.json`.

The audit report is evidence of a specific validation run and static-sample difference. It is not a cryptographic proof of model intent. For stronger provenance in a live demo, keep the Codex tool-call transcript showing `build_generation_context`, code generation, and `validate_generated_code` alongside the audit report.

## Validation Scope

The validator is deliberately simple. It checks:

- mapped components are imported from their contract packages,
- JSX props are listed in the adapted component contract,
- forbidden props are not used,
- generated JSX covers the expected mapped component usage from the context pack,
- raw color literals such as `#FF0000`, `rgb(...)`, or `hsl(...)` are not present.

It adapts the real `hugo-ui` contract shape from `props[]`, `forbiddenProps`, `discouragedProps`, `generationRules`, `validationRules`, and `tokenPolicy` into the internal validator format. The context pack still retains raw contract data for source traceability.

It is not a TypeScript compiler, visual diffing system, accessibility checker, or production policy engine.

## Trace Walkthrough

The trusted chain starts with a local design node and ends with a validation report:

1. MCP capture fixture: `fixtures/figma/mcp/edit-profile-modal.mcp-context.json` records local Figma MCP-shaped tool results: sparse XML metadata, React-like design context, a `get_code_connect_map` result, and variable definitions.
2. Normalized fixture: `npm run figma:normalize` writes `fixtures/figma/edit-profile-modal.fixture.json`, preserving node IDs, component IDs, typed component properties, selected layout data, Code Connect snippets, text values, and component metadata.
3. Design node: the normalized fixture contains `node-input-first-name`, an `Input/Text` instance with label text and sample value text carried from the MCP-shaped Code Connect context. Sample value text is retained for traceability, but the mapping does not hard-code it as an `Input value` prop.
4. Mapping: `code-connect/manifest.json` maps `node-input-first-name` to `Input` from `@hugo-ui/mui` and points at `vendor/hugo-ui/mui-ai-contract/components/Input.contract.json`. It is the local contract-enriched projection used by this demo, not a published Code Connect artifact.
5. Contract: the vendored `Input` contract defines the import package, prop list, `aiUsage` policy, discouraged props, generation rules, validation rules, and token policy.
6. Adapter: `mcp-server/src/contract-adapters/hugo-ui-mui.ts` converts the real contract shape into the internal validator format while preserving `rawContract` and policy metadata.
7. Context pack: `npm run context:pack` writes `generated/edit-profile-modal.context-pack.json`, combining the fixture frame, mapping metadata, vendored contracts, token policy, pattern rules, provenance, and `expectedComponentUsage`.
8. JSX: `generated/edit-profile-modal.generated.tsx` imports `Button`, `Input`, and `Modal` from `@hugo-ui/mui`.
9. Validator: `npm run validate` checks generated JSX against the adapted contracts and expected usage. The passing sample covers `Modal x1`, `Input x2`, and `Button x2`.

The invalid sample intentionally violates the chain by importing from the wrong package, using forbidden props, containing raw colors, and omitting mapped component coverage:

```bash
npm run validate:bad
```

## Project Structure

```text
fixtures/figma/mcp/                     Local Figma MCP-shaped tool-result fixtures.
fixtures/figma/                         Normalized local Figma-like JSON.
code-connect/manifest.json              Local contract-enriched Code Connect map projection.
code-connect/mock/                      Documentation-only Code Connect template shape mocks.
.cache/hugo-ui/mui-ai-contract/         Ignored runtime cache for synced contract artifacts.
vendor/hugo-ui/mui-ai-contract/         Vendored @hugo-ui/mui AI contract fallback snapshot.
contracts/patterns/                     Local page-level pattern contracts only.
mcp-server/                             MCP stdio, HTTP, HTTPS entries, adapter, local CLI, validator.
demo-app/                               Vite + React demo UI with preview shim.
generated/                              Static samples, captured MCP-run candidate, context pack, and audit report.
docs/                                   Architecture notes for future work.
scripts/normalize-figma-fixture.ts      Figma MCP-shaped capture to normalized fixture conversion.
scripts/audit-generated-output.ts       Candidate validation and static-sample similarity audit.
scripts/hugo-ui-contract.ts             Contract release listing, sync, status, and verification CLI.
scripts/sync-hugo-ui-contract.mjs       Legacy release artifact sync script kept for reference.
```

## Boundary Reminder

All design input comes from fixtures. The MCP capture fixture is still local and does not call the live Figma MCP server or Figma REST API. Component API knowledge and token policy for the main chain come from a verified `@hugo-ui/mui` AI contract artifact, either the committed vendor fallback or a synced local cache entry. The `contracts/` tree is reserved for local pattern contracts, not component or token contracts. Code Connect is represented by a local contract-enriched map projection and documentation-only template shape mocks. Generated React must go through the validator before it is treated as usable. No real Figma API, official Code Connect publish flow, or LLM call is part of this demo.

## License

MIT. See `LICENSE`.
