import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLogger } from "./logger";
import { fromRepoRoot } from "./paths";

export type ContractVersionSelector = string | undefined;

export type ContractSource = {
  selector: string;
  version: string;
  root: string;
  kind: "cache" | "vendor";
};

export type ContractRelease = {
  version: string;
  tag: string;
  draft: boolean;
  prerelease: boolean;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
};

export type SyncContractOptions = {
  repo?: string;
  selector?: string;
  tag?: string;
  fromFile?: string;
};

export type SyncContractResult = {
  version: string;
  root: string;
  source: "github-release" | "local-file";
  repo?: string;
  tag?: string;
  artifact?: string;
};

const defaultRepo = "HugoHZXu/hugo-ui";
const logger = createLogger("contract-store");
const vendorRootRelative = "vendor/hugo-ui/mui-ai-contract";
const expectedArtifactFormat = "hugo-ui-mui-ai-contract/v1";
const requiredFiles = [
  "manifest.json",
  "provenance.json",
  "schema/component-contract.schema.json",
  "schema/package-contract-manifest.schema.json",
  "components/Button.contract.json",
  "components/Input.contract.json",
  "components/Modal.contract.json",
  "tokens/token-map.contract.json",
  "metadata/components/Button.ai.json",
  "metadata/components/Input.ai.json",
  "metadata/components/Modal.ai.json"
];

export function getContractCacheRoot(): string {
  const configured = process.env.HUGO_UI_CONTRACT_CACHE_DIR;
  return configured
    ? path.resolve(configured)
    : fromRepoRoot(".cache/hugo-ui/mui-ai-contract");
}

export function getDefaultContractSelector(): string {
  return process.env.HUGO_UI_CONTRACT_VERSION ?? "vendor";
}

export async function resolveLocalContractSource(
  selector: ContractVersionSelector = getDefaultContractSelector()
): Promise<ContractSource> {
  const normalizedSelector = selector?.trim() || "vendor";
  const candidates = await listLocalContractCandidates();

  if (normalizedSelector === "vendor") {
    const vendor = candidates.find((candidate) => candidate.kind === "vendor");
    if (!vendor) {
      throw new Error("No vendored hugo-ui AI contract snapshot is available.");
    }
    return logResolvedContractSource({ ...vendor, selector: normalizedSelector });
  }

  if (normalizedSelector === "latest" || normalizedSelector === "stable") {
    const latest = newestVersion(candidates);
    if (!latest) {
      throw new Error("No cached or vendored hugo-ui AI contract versions are available.");
    }
    return logResolvedContractSource({ ...latest, selector: normalizedSelector });
  }

  const targetVersion =
    normalizedSelector === "installed"
      ? await readInstalledHugoUiVersion()
      : parseVersionSelector(normalizedSelector);
  const matching = newestVersion(
    candidates.filter((candidate) => compareVersions(candidate.version, targetVersion) <= 0)
  );

  if (!matching) {
    throw new Error(
      `No cached or vendored hugo-ui AI contract version is <= ${targetVersion}. Run contract:sync:hugo-ui first.`
    );
  }

  return logResolvedContractSource({ ...matching, selector: normalizedSelector });
}

export async function getContractStatus() {
  const candidates = await listLocalContractCandidates();
  let resolvedDefault: ContractSource | null = null;

  try {
    resolvedDefault = await resolveLocalContractSource();
  } catch {
    resolvedDefault = null;
  }

  return {
    repo: process.env.HUGO_UI_CONTRACT_REPO ?? defaultRepo,
    cacheRoot: getContractCacheRoot(),
    defaultSelector: getDefaultContractSelector(),
    resolvedDefault,
    versions: sortVersionsDescending(candidates).map(({ selector: _selector, ...candidate }) => candidate)
  };
}

export async function listRemoteContractReleases(
  repo = process.env.HUGO_UI_CONTRACT_REPO ?? defaultRepo
): Promise<ContractRelease[]> {
  const releases: ContractRelease[] = [];

  for (let page = 1; page <= 10; page += 1) {
    const pageReleases = await fetchJson<unknown[]>(
      `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`
    );

    for (const release of pageReleases) {
      if (!isReleaseRecord(release)) {
        continue;
      }

      const version = parseTagVersionOrNull(release.tag_name);
      if (!version) {
        continue;
      }

      releases.push({
        version,
        tag: release.tag_name,
        draft: release.draft,
        prerelease: release.prerelease,
        assets: release.assets.map((asset) => ({
          name: asset.name,
          browser_download_url: asset.browser_download_url
        }))
      });
    }

    if (pageReleases.length < 100) {
      break;
    }
  }

  return sortVersionsDescending(releases);
}

function logResolvedContractSource(source: ContractSource): ContractSource {
  logger.debug("Resolved local hugo-ui AI contract source.", {
    selector: source.selector,
    resolvedVersion: source.version,
    source: source.kind,
    root: displayPath(source.root)
  });

  return source;
}

export async function syncHugoUiContract(
  options: SyncContractOptions = {}
): Promise<SyncContractResult> {
  if (options.fromFile) {
    const artifactPath = path.resolve(options.fromFile);
    const version = parseArtifactVersion(path.basename(artifactPath));
    const checksumPath = await findAdjacentChecksum(artifactPath);
    if (checksumPath) {
      await verifyChecksum(artifactPath, checksumPath);
    }
    const root = await unpackContractArtifact(artifactPath, version);
    await verifyContractDirectory(root, version);
    return {
      version,
      root,
      source: "local-file",
      artifact: artifactPath
    };
  }

  const repo = options.repo ?? process.env.HUGO_UI_CONTRACT_REPO ?? defaultRepo;
  const releases = await listRemoteContractReleases(repo);
  const release = await resolveRemoteRelease(releases, options);
  const artifactName = `hugo-ui-mui-ai-contract-v${release.version}.tgz`;
  const artifactAsset = release.assets.find((asset) => asset.name === artifactName);
  const checksumAsset = release.assets.find((asset) => asset.name === `${artifactName}.sha256`);

  if (!artifactAsset) {
    throw new Error(`No ${artifactName} asset found for ${repo}@${release.tag}.`);
  }

  if (!checksumAsset) {
    throw new Error(`No ${artifactName}.sha256 asset found for ${repo}@${release.tag}.`);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hugo-ui-contract-"));

  try {
    const artifactPath = path.join(tempDir, artifactAsset.name);
    const checksumPath = path.join(tempDir, checksumAsset.name);
    await downloadFile(artifactAsset.browser_download_url, artifactPath);
    await downloadFile(checksumAsset.browser_download_url, checksumPath);
    await verifyChecksum(artifactPath, checksumPath);
    const root = await unpackContractArtifact(artifactPath, release.version);
    await verifyContractDirectory(root, release.version);

    return {
      version: release.version,
      root,
      source: "github-release",
      repo,
      tag: release.tag,
      artifact: artifactAsset.name
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function verifyVendorContract() {
  return verifyContractDirectory(fromRepoRoot(vendorRootRelative));
}

export async function verifyContractDirectory(
  root: string,
  expectedContractVersion?: string
) {
  for (const relativePath of requiredFiles) {
    if (!(await exists(path.join(root, relativePath)))) {
      throw new Error(`Missing required contract file: ${relativePath}`);
    }
  }

  const manifest = await readJson<Record<string, unknown>>(path.join(root, "manifest.json"));
  const provenance = await readJson<Record<string, unknown>>(
    path.join(root, "provenance.json")
  );

  if (provenance.sourcePackage !== "@hugo-ui/mui") {
    throw new Error(`Unexpected provenance.sourcePackage: ${provenance.sourcePackage}`);
  }

  if (provenance.sourcePackagePath !== "packages/mui") {
    throw new Error(
      `Unexpected provenance.sourcePackagePath: ${provenance.sourcePackagePath}`
    );
  }

  if (provenance.artifactFormat !== expectedArtifactFormat) {
    throw new Error(`Unexpected provenance.artifactFormat: ${provenance.artifactFormat}`);
  }

  assertEqual(
    String(manifest.packageVersion),
    String(provenance.contractVersion),
    "manifest.packageVersion",
    "provenance.contractVersion"
  );
  assertEqual(
    String(provenance.packageVersion),
    String(provenance.contractVersion),
    "provenance.packageVersion",
    "provenance.contractVersion"
  );

  if (expectedContractVersion) {
    assertEqual(
      String(provenance.contractVersion),
      expectedContractVersion,
      "provenance.contractVersion",
      "release/artifact version"
    );
  }

  const components = Array.isArray(manifest.components)
    ? manifest.components
        .map((component) =>
          isRecord(component) && typeof component.componentName === "string"
            ? component.componentName
            : undefined
        )
        .filter((componentName): componentName is string => Boolean(componentName))
    : [];

  for (const expectedComponent of ["Button", "Input", "Modal"]) {
    if (!components.includes(expectedComponent)) {
      throw new Error(`Manifest is missing ${expectedComponent}.`);
    }
  }

  return {
    packageName: manifest.packageName,
    packageVersion: manifest.packageVersion,
    contractVersion: provenance.contractVersion,
    sourceCommit: provenance.sourceCommit,
    artifactFormat: provenance.artifactFormat,
    components
  };
}

export function contractRelativePath(source: ContractSource, relativePath: string): string {
  return path.join(source.root, relativePath);
}

export function resolveMappedContractPath(
  source: ContractSource,
  contractPath: string
): string {
  const vendorPrefix = `${vendorRootRelative}/`;

  if (contractPath.startsWith(vendorPrefix)) {
    return path.join(source.root, contractPath.slice(vendorPrefix.length));
  }

  return path.isAbsolute(contractPath) ? contractPath : fromRepoRoot(contractPath);
}

async function resolveRemoteRelease(
  releases: ContractRelease[],
  options: SyncContractOptions
): Promise<ContractRelease> {
  if (options.tag) {
    const version = parseTagVersion(options.tag);
    const release = releases.find((candidate) => candidate.version === version);
    if (!release) {
      throw new Error(`No hugo-ui AI contract release found for tag ${options.tag}.`);
    }
    return release;
  }

  const selector = options.selector?.trim() || "installed";
  const activeReleases = releases.filter((release) => !release.draft);

  if (selector === "latest" || selector === "stable") {
    const latest = newestVersion(activeReleases);
    if (!latest) {
      throw new Error("No hugo-ui AI contract releases are available.");
    }
    return latest;
  }

  const targetVersion =
    selector === "installed" ? await readInstalledHugoUiVersion() : parseVersionSelector(selector);
  const matching = newestVersion(
    activeReleases.filter((release) => compareVersions(release.version, targetVersion) <= 0)
  );

  if (!matching) {
    throw new Error(`No hugo-ui AI contract release is <= ${targetVersion}.`);
  }

  return matching;
}

async function listLocalContractCandidates(): Promise<ContractSource[]> {
  const candidates: ContractSource[] = [];
  const vendorRoot = fromRepoRoot(vendorRootRelative);
  const vendorVersion = await readContractVersion(vendorRoot);

  if (vendorVersion) {
    candidates.push({
      selector: "vendor",
      version: vendorVersion,
      root: vendorRoot,
      kind: "vendor"
    });
  }

  const cacheRoot = getContractCacheRoot();
  const entries = await readDirIfExists(cacheRoot);

  for (const entry of entries) {
    const root = path.join(cacheRoot, entry);
    const version = await readContractVersion(root);

    if (!version) {
      continue;
    }

    candidates.push({
      selector: version,
      version,
      root,
      kind: "cache"
    });
  }

  return sortVersionsDescending(candidates);
}

async function readContractVersion(root: string): Promise<string | undefined> {
  try {
    const provenance = await readJson<Record<string, unknown>>(
      path.join(root, "provenance.json")
    );
    return typeof provenance.contractVersion === "string"
      ? provenance.contractVersion
      : undefined;
  } catch {
    return undefined;
  }
}

async function unpackContractArtifact(artifactPath: string, version: string): Promise<string> {
  const cacheRoot = getContractCacheRoot();
  const targetRoot = path.join(cacheRoot, version);
  const tempRoot = path.join(cacheRoot, `.tmp-${version}-${Date.now()}`);

  await fs.mkdir(cacheRoot, { recursive: true });
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(tempRoot, { recursive: true });

  try {
    execFileSync("tar", ["-xzf", artifactPath, "-C", tempRoot], {
      stdio: "inherit"
    });
    await fs.rm(targetRoot, { recursive: true, force: true });
    await fs.rename(tempRoot, targetRoot);
    return targetRoot;
  } catch (error) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

async function readInstalledHugoUiVersion(): Promise<string> {
  const configuredPackageJson = process.env.HUGO_UI_PACKAGE_JSON;
  const packageJsonPath = configuredPackageJson
    ? path.resolve(configuredPackageJson)
    : fromRepoRoot("node_modules/@hugo-ui/mui/package.json");

  const packageJson = await readJson<Record<string, unknown>>(packageJsonPath).catch(() => {
    throw new Error(
      "Could not read installed @hugo-ui/mui package version. Install @hugo-ui/mui or pass an explicit --version."
    );
  });

  if (typeof packageJson.version !== "string") {
    throw new Error(`No version field found in ${packageJsonPath}.`);
  }

  return packageJson.version;
}

async function findAdjacentChecksum(artifactPath: string): Promise<string | undefined> {
  const adjacent = `${artifactPath}.sha256`;
  return (await exists(adjacent)) ? adjacent : undefined;
}

async function verifyChecksum(artifactPath: string, checksumPath: string) {
  const expected = extractSha256(await fs.readFile(checksumPath, "utf8"));
  const actual = crypto
    .createHash("sha256")
    .update(await fs.readFile(artifactPath))
    .digest("hex");

  if (actual !== expected) {
    throw new Error(
      `Checksum mismatch for ${path.basename(artifactPath)}. Expected ${expected}, got ${actual}.`
    );
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: githubHeaders()
  });

  if (!response.ok) {
    throw new Error(`GitHub request failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

async function downloadFile(url: string, outputPath: string) {
  const response = await fetch(url, {
    headers: githubHeaders()
  });

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
}

function githubHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "design-contract-mcp"
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

function parseVersionSelector(selector: string): string {
  if (selector.startsWith("mui-ai-contract-v")) {
    return parseTagVersion(selector);
  }

  const match = selector.match(/^v?([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)$/);
  if (!match) {
    throw new Error(
      `Invalid contract version selector "${selector}". Use installed, latest, vendor, or a semver target such as 1.0.2.`
    );
  }

  return match[1];
}

function parseTagVersion(tag: string): string {
  const version = parseTagVersionOrNull(tag);
  if (!version) {
    throw new Error(
      `Invalid release tag "${tag}". Expected format: mui-ai-contract-v<version>.`
    );
  }
  return version;
}

function parseTagVersionOrNull(tag: string): string | undefined {
  return tag.match(/^mui-ai-contract-v([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)$/)?.[1];
}

function parseArtifactVersion(fileName: string): string {
  const match = fileName.match(
    /^hugo-ui-mui-ai-contract-v([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)\.tgz$/
  );

  if (!match) {
    throw new Error(
      `Invalid artifact file "${fileName}". Expected format: hugo-ui-mui-ai-contract-v<version>.tgz.`
    );
  }

  return match[1];
}

function compareVersions(a: string, b: string): number {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);

  for (const key of ["major", "minor", "patch"] as const) {
    if (parsedA[key] !== parsedB[key]) {
      return parsedA[key] - parsedB[key];
    }
  }

  if (parsedA.prerelease === parsedB.prerelease) {
    return 0;
  }

  if (!parsedA.prerelease) {
    return 1;
  }

  if (!parsedB.prerelease) {
    return -1;
  }

  return parsedA.prerelease.localeCompare(parsedB.prerelease);
}

function parseSemver(version: string) {
  const match = version.match(
    /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
  );

  if (!match) {
    throw new Error(`Invalid semver version: ${version}`);
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4] ?? ""
  };
}

function newestVersion<T extends { version: string }>(items: T[]): T | undefined {
  return sortVersionsDescending(items)[0];
}

function sortVersionsDescending<T extends { version: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const versionOrder = compareVersions(right.version, left.version);

    if (versionOrder !== 0) {
      return versionOrder;
    }

    return localSourcePriority(right) - localSourcePriority(left);
  });
}

function localSourcePriority(item: unknown): number {
  return isRecord(item) && item.kind === "cache" ? 1 : 0;
}

function displayPath(filePath: string): string {
  const relativePath = path.relative(fromRepoRoot("."), filePath);
  return relativePath.startsWith("..") || path.isAbsolute(relativePath)
    ? filePath
    : relativePath;
}

function extractSha256(raw: string): string {
  const match = raw.match(/[a-fA-F0-9]{64}/);
  if (!match) {
    throw new Error("Checksum file does not contain a valid SHA-256 hash.");
  }
  return match[0].toLowerCase();
}

async function readDirIfExists(directory: string): Promise<string[]> {
  try {
    return await fs.readdir(directory);
  } catch {
    return [];
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function assertEqual(
  actual: string,
  expected: string,
  actualLabel: string,
  expectedLabel: string
) {
  if (actual !== expected) {
    throw new Error(
      `Version mismatch: ${actualLabel} is ${actual}, but ${expectedLabel} is ${expected}.`
    );
  }
}

function isReleaseRecord(value: unknown): value is {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: Array<{ name: string; browser_download_url: string }>;
} {
  return (
    isRecord(value) &&
    typeof value.tag_name === "string" &&
    typeof value.draft === "boolean" &&
    typeof value.prerelease === "boolean" &&
    Array.isArray(value.assets)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
