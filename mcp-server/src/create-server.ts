import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  buildGenerationContext,
  getCodeConnectMap,
  getComponentContract,
  getDesignContext,
  getHugoUiContractStatus,
  validateGeneratedCodeTool
} from "./tools";
import { createLogger } from "./logger";
import type { ValidationReport } from "./types";

const logger = createLogger("mcp-tools");

export function createMcpServer() {
  const server = new McpServer({
    name: "design-contract-mcp",
    version: "0.1.0"
  }, {
    instructions:
      "Use build_generation_context before generating React. Generate code from returned design, mapping, contracts, pattern, and expectedComponentUsage; do not copy local generated examples. After generation, call validate_generated_code with the code and expectedComponentUsage. Treat validation failures as actionable and revise until valid. This server only reads local fixtures/contracts and validates code; it does not call an LLM or fetch live Figma data."
  });

  server.tool(
    "get_design_context",
    "Read captured Figma-like frame data from local fixtures.",
    {
      frameId: z.string()
    },
    async ({ frameId }) =>
      logToolCall(
        "get_design_context",
        { frameId },
        async () => jsonResponse(await getDesignContext(frameId))
      )
  );

  server.tool(
    "get_code_connect_map",
    "Resolve a design node to its local contract-enriched Code Connect component mapping.",
    {
      nodeId: z.string()
    },
    async ({ nodeId }) =>
      logToolCall(
        "get_code_connect_map",
        { nodeId },
        async () => jsonResponse(await getCodeConnectMap(nodeId))
      )
  );

  server.tool(
    "get_component_contract",
    "Read the local component contract for a mapped component.",
    {
      componentName: z.string(),
      contractVersion: z
        .string()
        .optional()
        .describe("Optional contract selector: vendor, latest, installed, or a semver target such as 1.0.2.")
    },
    async ({ componentName, contractVersion }) =>
      logToolCall(
        "get_component_contract",
        { componentName, contractVersion },
        async () =>
          jsonResponse(await getComponentContract(componentName, contractVersion))
      )
  );

  server.tool(
    "build_generation_context",
    "Combine fixture data, component mapping, contracts, tokens, and pattern rules.",
    {
      frameId: z.string(),
      contractVersion: z
        .string()
        .optional()
        .describe("Optional contract selector: vendor, latest, installed, or a semver target such as 1.0.2.")
    },
    async ({ frameId, contractVersion }) =>
      logToolCall(
        "build_generation_context",
        { frameId, contractVersion },
        async () =>
          jsonResponse(await buildGenerationContext(frameId, contractVersion))
      )
  );

  server.tool(
    "validate_generated_code",
    "Validate generated React usage against local component contracts.",
    {
      code: z.string(),
      expectedComponentUsage: z
        .array(
          z.object({
            nodeId: z.string(),
            nodeName: z.string(),
            componentName: z.string(),
            importName: z.string(),
            packageName: z.string(),
            contractPath: z.string(),
            contractVersion: z.string().optional(),
            contractSource: z.string().optional()
          })
        ),
      contractVersion: z
        .string()
        .optional()
        .describe("Optional contract selector. If omitted, validation uses the expectedComponentUsage version when present, otherwise the server default.")
    },
    async ({ code, expectedComponentUsage, contractVersion }) =>
      logToolCall(
        "validate_generated_code",
        {
          codeLength: code.length,
          expectedUsageCount: expectedComponentUsage.length,
          contractVersion
        },
        async () => {
          const report = await validateGeneratedCodeTool(
            code,
            expectedComponentUsage,
            contractVersion
          );
          return jsonResponse(report);
        },
        (response) => validationLogMeta(response)
      )
  );

  server.tool(
    "get_contract_status",
    "Read local hugo-ui AI contract cache and default selector status.",
    {},
    async () =>
      logToolCall(
        "get_contract_status",
        {},
        async () => jsonResponse(await getHugoUiContractStatus())
      )
  );

  return server;
}

async function logToolCall<T>(
  toolName: string,
  meta: Record<string, unknown>,
  run: () => Promise<T>,
  resultMeta?: (result: T) => Record<string, unknown>
): Promise<T> {
  const startedAt = Date.now();

  try {
    const result = await run();
    logger.info("MCP tool call completed.", {
      toolName,
      durationMs: Date.now() - startedAt,
      ...meta,
      ...(resultMeta?.(result) ?? {})
    });
    return result;
  } catch (error) {
    logger.error("MCP tool call failed.", {
      toolName,
      durationMs: Date.now() - startedAt,
      ...meta,
      error
    });
    throw error;
  }
}

function validationLogMeta(response: ReturnType<typeof jsonResponse>) {
  const report = JSON.parse(response.content[0].text) as ValidationReport;

  return {
    valid: report.valid,
    violationCount: report.violations.length,
    checks: Object.fromEntries(
      report.checks.map((check) => [check.id, check.status])
    )
  };
}

function jsonResponse(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}
