# Architecture Notes

## Intent

This repository demonstrates the consumer side of a contract-first design-to-code workflow for AI tooling. The main point is not visual fidelity. The point is to make design and component context explicit, queryable, versioned, and validateable before generated React usage is trusted.

The MCP server in this repository is intended for local development and controlled internal deployments. It is not a public internet-facing MCP SaaS service. Authentication, authorization, audit retention, log shipping, and enterprise policy enforcement are expected to be handled by the internal platform, gateway, allowlisted cloud service, or surrounding operations environment.

## Repository Relationship

`hugo-ui` owns the real design-system source and publishes a versioned `@hugo-ui/mui` AI contract artifact through GitHub Releases.

Design Contract MCP vendors one released artifact snapshot under `vendor/hugo-ui/mui-ai-contract/` as a reproducible fallback. The MCP tools can also resolve a locally cached GitHub Release artifact from `.cache/hugo-ui/mui-ai-contract/<version>/`.

## Contract Directory Boundaries

`vendor/hugo-ui/mui-ai-contract/` is the committed fallback source for component contracts and token contracts in the main chain.

`.cache/hugo-ui/mui-ai-contract/<version>/` is an ignored runtime cache populated from `HugoHZXu/hugo-ui` GitHub Release artifacts. Runtime MCP tools resolve against the cache and vendor fallback only; normal generation and validation calls do not fetch from GitHub.

`contracts/` is reserved for local demo pattern contracts, currently `contracts/patterns/modal-form.pattern.json`. It must not contain shadow component contracts or token maps, because those would compete with the vendored `@hugo-ui/mui` artifact and make validation provenance ambiguous.

## Context Flow

1. `vendor/hugo-ui/mui-ai-contract/` contains the committed release artifact fallback, including `manifest.json`, component contracts, tokens, metadata, schema files, and `provenance.json`.
2. `fixtures/figma/mcp/edit-profile-modal.mcp-context.json` is a local Figma MCP-shaped tool-result fixture. It records sparse XML metadata, React-like design context with `CodeConnectSnippet` markers, a `get_code_connect_map` result, and variable definitions.
3. `scripts/normalize-figma-fixture.ts` deterministically converts the MCP-shaped fixture into the smaller fixture shape consumed by the demo tools.
4. `fixtures/figma/edit-profile-modal.fixture.json` captures a single normalized local Figma-like frame while preserving source traceability back to the MCP-shaped capture.
5. `code-connect/manifest.json` maps selected design node IDs to `@hugo-ui/mui` component names and vendor contract files. It is the local contract-enriched projection used by this demo, not a published Code Connect artifact.
6. `code-connect/mock/` contains documentation-only Code Connect template shape mocks for `Modal`, `Input`, and `Button`. They are not part of the executable chain and must not be published.
7. `mcp-server/src/contract-store.ts` resolves the requested contract selector (`vendor`, `latest`, `installed`, or a semver target) against local cache plus vendor fallback.
8. `mcp-server/src/contract-adapters/hugo-ui-mui.ts` adapts the real `hugo-ui` contract shape into the validator's internal format while preserving raw contract data.
9. `contracts/patterns/modal-form.pattern.json` describes page-level structure and generation rules for the local fixture.
10. `mcp-server/src/tools.ts` reads the normalized fixture, mapping, resolved contract source, and pattern contract to build generation context.
11. `generated/edit-profile-modal.context-pack.json` records the resolved chain, contract version, contract source, and expected component usage.
12. `mcp-server/src/validator.ts` validates generated React usage against imports, props, forbidden props, raw colors, and expected mapped component coverage. Coverage validation requires `expectedComponentUsage` from the context pack.
13. `scripts/audit-generated-output.ts` records a validation audit for a captured candidate, including candidate/context hashes and static-sample similarity.
14. `demo-app/` visualizes the same chain for humans.

## Contract Version Resolution

The design-system team decides when a new contract is required. Internal bug fixes or style changes in `@hugo-ui/mui` do not need a new contract release if they do not change generated code shape, supported props, token policy, or validation rules.

The MCP side keeps version selection intentionally simple:

- `vendor` uses the committed fallback snapshot.
- `latest` uses the newest locally available cached or vendored contract.
- `installed` reads the local `@hugo-ui/mui` package version and selects the newest locally available contract whose version is less than or equal to that package version.
- a semver selector such as `1.0.5` selects the newest locally available contract whose version is less than or equal to that target.

`npm run contract:sync:hugo-ui` is the only normal path that contacts GitHub. It applies the same `latest` / `installed` / semver resolution against remote `mui-ai-contract-v*` releases, verifies the downloaded checksum, unpacks the artifact into `.cache/`, and verifies provenance before the runtime tools use it.

`npm run mcp:server`, `npm run mcp:http`, and `npm run mcp:https` share the same MCP server factory and tool registration. The stdio, HTTP, and HTTPS entrypoints differ only in transport and TLS termination location. For cloud deployments, set `MCP_AUTH_MODE=external` when authentication is enforced by the platform, gateway, IAM layer, SSO proxy, or allowlist service before requests reach this process. The MCP server records that mode in health checks and logs, but it does not store auth secrets or validate tokens in that mode. `MCP_ALLOWED_HOSTS` and `MCP_ALLOWED_ORIGINS` provide generic host and browser-origin filtering hooks without coupling the demo to a specific enterprise platform.

## Generation Provenance

The validator proves contract conformance, not authorship. A candidate can pass validation whether it was generated live, copied from a file, or written by hand.

For demo provenance, use `npm run audit:generated` after a captured Codex MCP run. The deterministic audit report binds the candidate code to a specific context pack hash, includes the validator result, and records similarity against committed static samples. This makes the run easier to inspect without claiming cryptographic proof of model intent.

## Why The MCP Server Is Thin

The MCP server should only expose context, local contract status, and validation tools. It should not call an LLM, fetch remote design data, or mutate source files during normal tool calls. This keeps the architecture understandable: generation can happen in an external AI tool, while this server supplies bounded context and checks the generated result.

## Contract Adapter Shape

The real `hugo-ui` contracts contain:

- `props[]`
- `props[].aiUsage`
- `props[].required`
- `forbiddenProps`
- `discouragedProps`
- `generationRules`
- `validationRules`
- `tokenPolicy`

The adapter converts these into the internal validator shape:

- `allowedProps`
- `requiredProps`
- `forbiddenProps`
- `discouragedProps`
- `conditionalProps`
- `policy`
- `rawContract`

The internal shape is an implementation detail. The context pack should retain enough raw contract and provenance data to trace validation decisions back to the published artifact.

## Limitations

This demo does not parse arbitrary Figma documents, call the live Figma MCP server, publish Code Connect metadata, require a live `@hugo-ui/mui` npm install, or guarantee production-ready React. It uses a local Figma MCP-shaped tool-result fixture, a deterministic normalization step, a local contract-enriched Code Connect map projection, and a verified AI contract artifact from either vendor fallback or local cache to show an architecture pattern.
