export type FigmaComponentPropertyValue = {
  type: string;
  value: string | boolean | number;
  preferredValues?: unknown[];
  boundVariables?: Record<string, unknown>;
};

export type DesignNode = {
  id: string;
  name: string;
  type: string;
  componentId?: string;
  componentSet?: string;
  componentMetadata?: {
    key: string;
    name: string;
    componentSetId?: string;
    componentSetName?: string;
    remote: boolean;
  };
  componentProperties?: Record<
    string,
    string | boolean | number | FigmaComponentPropertyValue
  >;
  text?: Record<string, string>;
  options?: Array<Record<string, string>>;
  layout?: Record<string, unknown>;
  children?: DesignNode[];
  [key: string]: unknown;
};

export type DesignFrame = DesignNode & {
  description?: string;
};

export type FigmaLikeFixture = {
  schemaVersion: string;
  source: string;
  file: {
    id: string;
    name: string;
  };
  rawSource?: {
    schemaVersion: string;
    source: string;
    path: string;
    capturedAt?: string;
    documentRootId: string;
    tools?: string[];
  };
  frames: DesignFrame[];
};

export type CodeConnectMapping = {
  nodeId: string;
  figmaNodeName: string;
  figmaComponent: string;
  componentName: string;
  importName: string;
  contractPath: string;
  propMapping: Record<string, string>;
  ignoredDesignFields?: Array<{
    path: string;
    reason: string;
  }>;
};

export type CodeConnectManifest = {
  schemaVersion: string;
  description: string;
  componentPackage: string;
  mappings: CodeConnectMapping[];
};

export type ComponentContract = {
  schemaVersion: string;
  componentName: string;
  packageName: string;
  importName: string;
  description: string;
  requiredProps: string[];
  allowedProps: Record<string, unknown>;
  forbiddenProps: string[];
  discouragedProps?: string[];
  conditionalProps?: string[];
  policy?: {
    sourceArtifact?: string;
    sourceContractPath?: string;
    discouragedProps?: Array<Record<string, unknown>>;
    conditionalProps?: Array<Record<string, unknown>>;
    generationRules?: Array<Record<string, unknown>>;
    validationRules?: Array<Record<string, unknown>>;
    tokenPolicy?: Record<string, unknown>;
  };
  rawContract?: Record<string, unknown>;
  designMappings?: Record<string, unknown>;
};

export type TokenMapContract = {
  schemaVersion: string;
  [key: string]: unknown;
};

export type PatternContract = {
  schemaVersion: string;
  patternName: string;
  frameIds: string[];
  description: string;
  allowedComponents: string[];
  structure: Array<Record<string, unknown>>;
  generationRules: string[];
};

export type ValidationStatus = "pass" | "fail";

export type ValidationCheck = {
  id: string;
  status: ValidationStatus;
  message: string;
};

export type ValidationViolation = {
  rule: string;
  componentName?: string;
  prop?: string;
  value?: string;
  expectedCount?: number;
  foundCount?: number;
  message: string;
};

export type ValidationReport = {
  valid: boolean;
  checks: ValidationCheck[];
  violations: ValidationViolation[];
};

export type ExpectedComponentUsage = {
  nodeId: string;
  nodeName: string;
  componentName: string;
  importName: string;
  packageName: string;
  contractPath: string;
  contractVersion?: string;
  contractSource?: string;
};

export type ValidationOptions = {
  expectedComponentUsage?: ExpectedComponentUsage[];
};
