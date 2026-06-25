# MVP To Product Direction

This document compares the current MVP with the shape a real internal product would likely take. It intentionally stays high level because the exact implementation depends on the team's Figma setup, deployment platform, security policy, and artifact infrastructure.

The target product shape is still internal. This repository is not intended to become a public internet-facing MCP SaaS service.

## 1. Figma MCP

### Current MVP

The project does not connect to the live Figma MCP server or Figma REST API. Design input comes from committed JSON fixtures under `fixtures/figma/`, with one Figma MCP-shaped tool-result fixture normalized into the smaller structure consumed by the demo tools.

This keeps the demo deterministic and avoids mixing contract validation with live design-data concerns.

### Real Product Direction

A real product would normally replace the local fixture source with an internal Figma MCP service or a controlled design-ingestion service. That service would handle Figma auth, file access, node selection, caching, rate limits, and any organization-specific permission model.

The contract MCP server should still stay thin. It should consume already-authorized design context from the Figma side instead of directly owning Figma tokens, workspace permissions, or broad document crawling.

Likely additions:

- a design context provider interface instead of hardcoded fixture reads,
- stable frame/node identifiers from the real Figma source,
- cache and freshness metadata for design snapshots,
- clear errors when a file, frame, or node is not accessible,
- explicit boundaries for supported design patterns instead of claiming arbitrary Figma-to-code support.

## 2. Code Connect

### Current MVP

The repository uses `code-connect/manifest.json` as a local contract-enriched projection of a Figma MCP `get_code_connect_map` result. The files under `code-connect/mock/` are documentation-only mocks. Nothing is published to Figma, and the project does not claim official Code Connect compatibility.

### Real Product Direction

A real product would need an owned mapping source that connects design components to implementation components in a repeatable way. Depending on the team's process, that source could be official Code Connect, an internal registry, or a generated mapping artifact owned by the design-system team.

The important product boundary is that component resolution should remain explicit. The MCP server should not infer hidden component APIs or silently guess mappings that are not backed by the registry.

Likely additions:

- a versioned mapping artifact published with the design system,
- mapping validation against the AI contract manifest,
- tooling that detects stale or missing mappings,
- support for multiple packages or component namespaces if the design system grows,
- a policy for deprecated components and aliases.

## 3. HTTP/HTTPS Deployment And Cloud Services

### Current MVP

The project supports three MCP entrypoints:

- `npm run mcp:server` for local stdio,
- `npm run mcp:http` for Streamable HTTP,
- `npm run mcp:https` for Node-managed TLS when needed.

HTTP and HTTPS share the same MCP server factory, request handler, contract resolver, health check, host filtering, browser-origin filtering, and structured stderr logs. `MCP_AUTH_MODE=external` records that authentication is expected to be enforced by an upstream platform.

The server does not implement OAuth, SSO, RBAC, audit retention, log shipping, billing, quota, or multi-tenant isolation.

### Real Product Direction

For internal use, the usual production shape is to place this server behind an enterprise gateway, internal platform, allowlisted cloud service, or private network boundary. TLS termination, authentication, authorization, request logging, secret management, and audit retention should be owned by that platform unless a concrete requirement says otherwise.

The MCP server should focus on predictable runtime behavior:

- read-only tool calls during normal generation,
- deterministic contract resolution from local cache,
- health/readiness endpoints,
- structured logs that can be collected by the platform,
- explicit startup configuration and clear warnings for unsafe combinations.

Likely additions when a deployment target is known:

- a Dockerfile and deployment example for that environment,
- a startup or init step for contract synchronization,
- readiness checks for required contract versions,
- platform-specific log and metrics integration,
- explicit allowlists for hosts and browser origins,
- smoke tests that run against the deployed endpoint.

## 4. AI Contract Management

### Current MVP

The committed fallback lives under `vendor/hugo-ui/mui-ai-contract/`. Runtime tools can also read contract artifacts unpacked into `.cache/hugo-ui/mui-ai-contract/<version>/`.

The sync command can fetch GitHub Release artifacts, verify checksums, unpack them, and verify provenance. Runtime MCP tool calls do not contact GitHub.

The current selector model is intentionally simple:

- `vendor`,
- `latest`,
- `installed`,
- or a semver target such as `1.0.2`.

### Real Product Direction

In a real internal product, the design-system release pipeline should publish immutable AI contract artifacts to a durable artifact store such as S3, GCS, OSS, an internal package registry, or another approved artifact repository. GitHub Releases are sufficient for this demo, but object storage or an artifact registry is usually a better long-term operational boundary.

The recommended model is deployment-time synchronization, not request-time synchronization:

```text
design-system release
  -> publish immutable contract artifact and checksum
  -> update artifact index
deployment pipeline or init step
  -> select supported contract versions
  -> download and verify artifacts
  -> unpack into local read-only cache
MCP runtime
  -> resolve from local cache only
```

This avoids network variability during AI tool calls and makes generated context reproducible.

Likely additions:

- an artifact index that records supported, latest, and deprecated contract versions,
- sync by explicit version, version range, or supported set,
- retention rules for old local cache entries,
- support for an object-storage artifact source in addition to GitHub Releases,
- deployment checks that fail fast when required contract versions are missing,
- a design-system release gate that only publishes a new AI contract when external AI usage behavior changes.

Bug fixes or internal style changes in the design system should not require new contract artifacts unless they change generated code shape, supported props, token policy, validation rules, or documented AI usage guidance.

## Summary

The MVP demonstrates the core contract-first MCP workflow: resolve bounded design context, map it to component contracts, build generation context, and validate generated React. A real internal product would mostly add integration boundaries around it: live design context, authoritative mapping publication, deployment hardening, and durable contract artifact management.

Those additions should be driven by concrete platform requirements. Until then, the server should remain small, read-only during normal tool calls, and explicit about what it does not own.
