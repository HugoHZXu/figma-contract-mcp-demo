import fs from "node:fs/promises";
import path from "node:path";
import { fromRepoRoot } from "../mcp-server/src/paths";
import type {
  DesignFrame,
  DesignNode,
  FigmaComponentPropertyValue,
  FigmaLikeFixture
} from "../mcp-server/src/types";

const defaultInputPath = "fixtures/figma/mcp/edit-profile-modal.mcp-context.json";
const defaultOutputPath = "fixtures/figma/edit-profile-modal.fixture.json";
const defaultFrameId = "frame-edit-profile";

const [inputPath = defaultInputPath, outputPath = defaultOutputPath, frameId = defaultFrameId] =
  process.argv.slice(2);

const mcpCapture = await readJson<FigmaMcpCaptureFixture>(inputPath);
const metadataRoot = parseSparseXml(mcpCapture.toolResults.get_metadata.content);
const frame = findMetadataNode(metadataRoot, frameId);

if (!frame) {
  throw new Error(`Frame not found in Figma MCP metadata fixture: ${frameId}`);
}

const fixture: FigmaLikeFixture = {
  schemaVersion: "figma-like-fixture/v2",
  source: "normalized-from-local-figma-mcp-fixture",
  file: {
    id: mcpCapture.file.key,
    name: mcpCapture.file.name
  },
  rawSource: {
    schemaVersion: mcpCapture.schemaVersion,
    source: mcpCapture.source,
    path: inputPath,
    capturedAt: mcpCapture.capturedAt,
    documentRootId: mcpCapture.selection.nodeId,
    tools: Object.keys(mcpCapture.toolResults)
  },
  frames: [normalizeFrame(frame, mcpCapture)]
};

const absoluteOutputPath = fromRepoRoot(outputPath);
await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });
await fs.writeFile(absoluteOutputPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");

console.log(`Normalized ${inputPath} -> ${outputPath}`);

type FigmaMcpCaptureFixture = {
  schemaVersion: string;
  source: string;
  capturedAt?: string;
  file: {
    key: string;
    name: string;
    url?: string;
  };
  selection: {
    nodeId: string;
    name: string;
    type: string;
  };
  toolResults: {
    get_metadata: {
      format: "sparse-xml";
      content: string;
    };
    get_design_context?: {
      format: string;
      content: string;
    };
    get_code_connect_map: {
      componentPackage: string;
      mappings: Record<string, FigmaMcpCodeConnectEntry>;
    };
    get_variable_defs?: {
      variables?: Record<string, unknown>;
      styles?: Record<string, unknown>;
    };
    [toolName: string]: unknown;
  };
};

type FigmaMcpCodeConnectEntry = {
  componentName: string;
  importName?: string;
  figmaComponent?: string;
  componentId?: string;
  source?: string;
  label?: string;
  version?: string;
  snippet?: string;
  snippetImports?: string[];
  snippetNestedFunctions?: string[];
  designProperties?: Record<
    string,
    string | boolean | number | FigmaComponentPropertyValue
  >;
  text?: Record<string, string>;
  contractPath?: string;
};

type SparseXmlNode = {
  tag: string;
  attrs: Record<string, string>;
  children: SparseXmlNode[];
};

function normalizeFrame(
  node: SparseXmlNode,
  capture: FigmaMcpCaptureFixture
): DesignFrame {
  return normalizeNode(node, capture) as DesignFrame;
}

function normalizeNode(
  node: SparseXmlNode,
  capture: FigmaMcpCaptureFixture
): DesignNode {
  const mapping = capture.toolResults.get_code_connect_map.mappings[node.attrs.id];
  const normalized: DesignNode = {
    id: requireAttr(node, "id"),
    name: requireAttr(node, "name"),
    type: normalizeNodeType(node)
  };
  const layout = normalizeLayout(node.attrs);
  const bounds = normalizeBounds(node.attrs);

  if (node.attrs.description) {
    normalized.description = node.attrs.description;
  }

  if (mapping?.componentId) {
    normalized.componentId = mapping.componentId;
  }

  if (mapping?.figmaComponent) {
    normalized.componentSet = mapping.figmaComponent;
    normalized.componentMetadata = {
      key: mapping.componentId ?? `mcp:${normalized.id}`,
      name: mapping.figmaComponent,
      componentSetId: mapping.componentId,
      componentSetName: mapping.figmaComponent,
      remote: true
    };
  }

  if (mapping?.designProperties) {
    normalized.componentProperties = mapping.designProperties;
  }

  if (mapping?.text && Object.keys(mapping.text).length > 0) {
    normalized.text = mapping.text;
  }

  if (mapping) {
    normalized.codeConnect = {
      componentName: mapping.componentName,
      importName: mapping.importName ?? mapping.componentName,
      source: mapping.source,
      label: mapping.label,
      version: mapping.version,
      snippetImports: mapping.snippetImports ?? [],
      snippet: mapping.snippet,
      snippetNestedFunctions: mapping.snippetNestedFunctions ?? []
    };
  }

  if (layout) {
    normalized.layout = layout;
  }

  if (bounds) {
    normalized.absoluteBoundingBox = bounds;
    normalized.absoluteRenderBounds = bounds;
  }

  const children = node.children
    .filter((child) => normalizeNodeType(child) !== "TEXT")
    .map((child) => normalizeNode(child, capture));

  if (children.length > 0) {
    normalized.children = children;
  }

  return normalized;
}

function parseSparseXml(xml: string): SparseXmlNode {
  const root: SparseXmlNode = { tag: "root", attrs: {}, children: [] };
  const stack = [root];
  const tagPattern = /<([^!?][^>]*?)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(xml)) !== null) {
    const rawTag = match[1].trim();
    if (!rawTag || rawTag.startsWith("?")) {
      continue;
    }

    if (rawTag.startsWith("/")) {
      const closingTag = rawTag.slice(1).trim();
      const current = stack.pop();
      if (!current || current.tag !== closingTag) {
        throw new Error(`Malformed sparse XML: unexpected closing tag ${closingTag}`);
      }
      continue;
    }

    const selfClosing = rawTag.endsWith("/");
    const normalizedTag = selfClosing ? rawTag.slice(0, -1).trim() : rawTag;
    const firstWhitespaceIndex = normalizedTag.search(/\s/);
    const tag =
      firstWhitespaceIndex === -1
        ? normalizedTag
        : normalizedTag.slice(0, firstWhitespaceIndex);
    const attrText =
      firstWhitespaceIndex === -1 ? "" : normalizedTag.slice(firstWhitespaceIndex + 1);
    const node: SparseXmlNode = {
      tag,
      attrs: parseXmlAttrs(attrText),
      children: []
    };
    const parent = stack.at(-1);
    if (!parent) {
      throw new Error("Malformed sparse XML: missing parent node");
    }
    parent.children.push(node);

    if (!selfClosing) {
      stack.push(node);
    }
  }

  if (stack.length !== 1) {
    throw new Error("Malformed sparse XML: one or more tags were not closed");
  }

  return root.children.length === 1 ? root.children[0] : root;
}

function parseXmlAttrs(input: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrPattern = /([A-Za-z_:][A-Za-z0-9_:.-]*)="([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = attrPattern.exec(input)) !== null) {
    attrs[match[1]] = decodeXmlEntities(match[2]);
  }

  return attrs;
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function findMetadataNode(node: SparseXmlNode, nodeId: string): SparseXmlNode | null {
  if (node.attrs.id === nodeId) {
    return node;
  }

  for (const child of node.children) {
    const found = findMetadataNode(child, nodeId);
    if (found) {
      return found;
    }
  }

  return null;
}

function normalizeNodeType(node: SparseXmlNode): string {
  return node.attrs.type ?? node.tag.toUpperCase();
}

function normalizeLayout(attrs: Record<string, string>): Record<string, unknown> | undefined {
  const layout: Record<string, unknown> = {};
  const width = parseOptionalNumber(attrs.width);
  const height = parseOptionalNumber(attrs.height);
  const gap = parseOptionalNumber(attrs.gap);
  const padding = normalizePadding(attrs);

  if (width !== undefined) {
    layout.width = width;
  }

  if (height !== undefined) {
    layout.height = height;
  }

  if (attrs.layout) {
    layout.mode = attrs.layout;
  }

  if (attrs.align) {
    layout.align = attrs.align;
  }

  if (gap !== undefined) {
    layout.itemSpacing = gap;
  }

  if (attrs.gapToken) {
    layout.gapToken = attrs.gapToken;
  }

  if (padding) {
    layout.padding = padding;
  }

  const boundVariables = normalizeBoundVariables(attrs);
  if (boundVariables) {
    layout.boundVariables = boundVariables;
  }

  return Object.keys(layout).length > 0 ? layout : undefined;
}

function normalizeBounds(
  attrs: Record<string, string>
): { x: number; y: number; width: number; height: number } | undefined {
  const x = parseOptionalNumber(attrs.x);
  const y = parseOptionalNumber(attrs.y);
  const width = parseOptionalNumber(attrs.width);
  const height = parseOptionalNumber(attrs.height);

  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined
  ) {
    return undefined;
  }

  return { x, y, width, height };
}

function normalizePadding(attrs: Record<string, string>): Record<string, number> | undefined {
  const padding = {
    left: parseOptionalNumber(attrs.paddingLeft),
    right: parseOptionalNumber(attrs.paddingRight),
    top: parseOptionalNumber(attrs.paddingTop),
    bottom: parseOptionalNumber(attrs.paddingBottom)
  };
  const definedPadding = Object.fromEntries(
    Object.entries(padding).filter(([, value]) => value !== undefined)
  );

  return Object.keys(definedPadding).length > 0
    ? (definedPadding as Record<string, number>)
    : undefined;
}

function normalizeBoundVariables(
  attrs: Record<string, string>
): Record<string, { type: "VARIABLE_ALIAS"; id: string }> | undefined {
  const variables: Record<string, { type: "VARIABLE_ALIAS"; id: string }> = {};

  if (attrs.gapToken) {
    variables.itemSpacing = {
      type: "VARIABLE_ALIAS",
      id: attrs.gapToken
    };
  }

  return Object.keys(variables).length > 0 ? variables : undefined;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function requireAttr(node: SparseXmlNode, attrName: string): string {
  const value = node.attrs[attrName];
  if (!value) {
    throw new Error(`Sparse XML node <${node.tag}> is missing required ${attrName}.`);
  }

  return value;
}

async function readJson<T>(relativePath: string): Promise<T> {
  const raw = await fs.readFile(fromRepoRoot(relativePath), "utf8");
  return JSON.parse(raw) as T;
}
