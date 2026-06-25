import contextPackJson from "../../generated/edit-profile-modal.context-pack.json";
import auditReportJson from "../../generated/edit-profile-modal.audit-report.json";
import mcpRunGeneratedCode from "../../generated/edit-profile-modal.mcp-run.generated.jsx?raw";
import validGeneratedCode from "../../generated/edit-profile-modal.generated.tsx?raw";
import invalidGeneratedCode from "../../generated/edit-profile-modal.invalid.generated.tsx?raw";
import type {
  ComponentContract,
  DesignNode,
  ExpectedComponentUsage
} from "../../mcp-server/src/types";
import { validateGeneratedCode } from "../../mcp-server/src/validator";
import { useMemo, useState } from "react";

type ContextPack = {
  frameId: string;
  design: {
    file: {
      id: string;
      name: string;
    };
    source: string;
    frame: DesignNode;
  };
  codeConnect: {
    schemaVersion: string;
    componentPackage: string;
    mappings: Array<{
      nodeId: string;
      figmaNodeName: string;
      figmaComponent: string;
      componentName: string;
      importName: string;
      contractPath: string;
      propMapping: Record<string, string>;
    }>;
  };
  pattern: {
    patternName: string;
  } | null;
  componentContracts: ComponentContract[];
  expectedComponentUsage: ExpectedComponentUsage[];
};

type AuditReport = {
  candidate: {
    path: string;
    sha256: string;
  };
  context: {
    path: string;
    sha256: string;
  };
  staticReferences: Array<{
    path: string;
    similarity: number;
    exactNormalizedMatch: boolean;
  }>;
  checks: Array<{
    id: string;
    status: "pass" | "fail";
    message: string;
  }>;
};

type SampleKey = "mcpRun" | "valid" | "invalid";

const contextPack = contextPackJson as unknown as ContextPack;
const auditReport = auditReportJson as unknown as AuditReport;
const frame = contextPack.design.frame;
const contracts = contextPack.componentContracts;
const generatedSamples: Record<SampleKey, { label: string; code: string }> = {
  mcpRun: {
    label: "MCP run",
    code: mcpRunGeneratedCode
  },
  valid: {
    label: "Static pass",
    code: validGeneratedCode
  },
  invalid: {
    label: "Static fail",
    code: invalidGeneratedCode
  }
};

export default function App() {
  const [selectedNodeId, setSelectedNodeId] = useState("node-modal");
  const [sampleKey, setSampleKey] = useState<SampleKey>("valid");
  const selectedNode = findNode(frame, selectedNodeId) ?? frame;
  const mapping =
    contextPack.codeConnect.mappings.find(
      (candidate) => candidate.nodeId === selectedNode.id
    ) ?? null;
  const contract =
    mapping === null
      ? null
      : contracts.find(
          (candidate) => candidate.componentName === mapping.componentName
        ) ?? null;
  const generatedCode = generatedSamples[sampleKey].code;

  const validationReport = useMemo(
    () =>
      validateGeneratedCode(generatedCode, contracts, {
        expectedComponentUsage: contextPack.expectedComponentUsage
      }),
    [generatedCode]
  );

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <h1>Design Contract MCP</h1>
          <p>Figma MCP context to mapping to contract to generated React to validation</p>
        </div>
        <span className="status-pill">context-pack.json</span>
      </header>

      <section className="workspace" aria-label="Design-to-code chain">
        <aside className="column design-column">
          <div className="column-header">
            <h2>Design Tree</h2>
            <span>{contextPack.design.file.name}</span>
          </div>
          <ul className="tree">
            <DesignTree
              node={frame}
              selectedNodeId={selectedNodeId}
              onSelect={setSelectedNodeId}
            />
          </ul>
        </aside>

        <section className="column contract-column">
          <div className="column-header">
            <h2>Mapping + Contract</h2>
            <span>{contextPack.pattern?.patternName ?? "no pattern"}</span>
          </div>

          <section className="detail-block">
            <h3>Selected Node</h3>
            <dl className="metadata">
              <div>
                <dt>ID</dt>
                <dd>{selectedNode.id}</dd>
              </div>
              <div>
                <dt>Name</dt>
                <dd>{selectedNode.name}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{selectedNode.type}</dd>
              </div>
            </dl>
          </section>

          <section className="detail-block">
            <h3>Resolved Mapping</h3>
            {mapping ? (
              <pre>{JSON.stringify(mapping, null, 2)}</pre>
            ) : (
              <p className="muted">No component mapping for this node.</p>
            )}
          </section>

          <section className="detail-block">
            <h3>Component Contract</h3>
            {contract ? (
              <ContractSummary contract={contract} />
            ) : (
              <p className="muted">Select a mapped component node.</p>
            )}
          </section>
        </section>

        <section className="column generated-column">
          <div className="column-header">
            <h2>Generated Code + Validation</h2>
            <span>{validationReport.valid ? "Pass" : "Fail"}</span>
          </div>

          <div className="sample-switch" role="tablist" aria-label="Generated sample">
            {(Object.keys(generatedSamples) as SampleKey[]).map((key) => (
              <button
                key={key}
                className={sampleKey === key ? "sample-active" : ""}
                type="button"
                onClick={() => setSampleKey(key)}
              >
                {generatedSamples[key].label}
              </button>
            ))}
          </div>

          <section className="detail-block code-block">
            <h3>Generated React</h3>
            <pre>{generatedCode}</pre>
          </section>

          <section className="detail-block">
            <h3>Validation Report</h3>
            <ul className="checks">
              {validationReport.checks.map((check) => (
                <li key={check.id} className={`check check-${check.status}`}>
                  <strong>{check.id}</strong>
                  <span>{check.message}</span>
                </li>
              ))}
            </ul>
            {validationReport.violations.length > 0 ? (
              <pre>{JSON.stringify(validationReport.violations, null, 2)}</pre>
            ) : (
              <p className="pass-copy">No contract violations found.</p>
            )}
          </section>

          <section className="detail-block">
            <h3>Generation Audit</h3>
            <dl className="metadata audit-metadata">
              <div>
                <dt>Candidate</dt>
                <dd>{auditReport.candidate.path}</dd>
              </div>
              <div>
                <dt>Code SHA</dt>
                <dd>{shortHash(auditReport.candidate.sha256)}</dd>
              </div>
              <div>
                <dt>Context SHA</dt>
                <dd>{shortHash(auditReport.context.sha256)}</dd>
              </div>
            </dl>
            <ul className="checks audit-checks">
              {auditReport.checks.map((check) => (
                <li key={check.id} className={`check check-${check.status}`}>
                  <strong>{check.id}</strong>
                  <span>{check.message}</span>
                </li>
              ))}
            </ul>
            <div className="reference-list">
              {auditReport.staticReferences.map((reference) => (
                <div key={reference.path}>
                  <span>{reference.path}</span>
                  <strong>{reference.similarity.toFixed(3)}</strong>
                </div>
              ))}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}

type DesignTreeProps = {
  node: DesignNode;
  selectedNodeId: string;
  onSelect: (nodeId: string) => void;
};

function DesignTree({ node, selectedNodeId, onSelect }: DesignTreeProps) {
  const isSelected = node.id === selectedNodeId;

  return (
    <li>
      <button
        className={`tree-item ${isSelected ? "tree-item-selected" : ""}`}
        type="button"
        onClick={() => onSelect(node.id)}
      >
        <span className="node-type">{node.type}</span>
        <span className="node-name">{node.name}</span>
      </button>
      {node.children?.length ? (
        <ul>
          {node.children.map((child) => (
            <DesignTree
              key={child.id}
              node={child}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function ContractSummary({ contract }: { contract: ComponentContract }) {
  return (
    <div className="contract-summary">
      <dl className="metadata">
        <div>
          <dt>Component</dt>
          <dd>{contract.componentName}</dd>
        </div>
        <div>
          <dt>Import</dt>
          <dd>
            {contract.importName} from {contract.packageName}
          </dd>
        </div>
      </dl>

      <div className="prop-section">
        <h4>Allowed Props</h4>
        <div className="prop-list">
          {Object.keys(contract.allowedProps).map((prop) => (
            <span key={prop}>{prop}</span>
          ))}
        </div>
      </div>

      <div className="prop-section">
        <h4>Forbidden Props</h4>
        <div className="prop-list prop-list-danger">
          {contract.forbiddenProps.map((prop) => (
            <span key={prop}>{prop}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function findNode(node: DesignNode, nodeId: string): DesignNode | null {
  if (node.id === nodeId) {
    return node;
  }

  for (const child of node.children ?? []) {
    const found = findNode(child, nodeId);
    if (found) {
      return found;
    }
  }

  return null;
}

function shortHash(value: string): string {
  return value.slice(0, 12);
}
