#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = path.join(repoRoot, "vendor/hugo-ui/mui-ai-contract");
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

const args = parseArgs(process.argv.slice(2));

if (args["verify-only"]) {
  const summary = await verifySnapshot();
  printSummary("Verified hugo-ui AI contract snapshot", summary);
  process.exit(0);
}

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hugo-ui-contract-"));

try {
  const artifact = args["from-file"]
    ? artifactFromLocalFile(String(args["from-file"]))
    : await downloadReleaseArtifact(tempDir, args);
  const checksumPath = await resolveChecksumPath(artifact.path, tempDir, args);

  if (checksumPath) {
    await verifyChecksum(artifact.path, checksumPath);
  } else if (!args["from-file"]) {
    throw new Error("Release artifact checksum was not downloaded.");
  }

  await fs.rm(vendorDir, { recursive: true, force: true });
  await fs.mkdir(vendorDir, { recursive: true });
  execFileSync("tar", ["-xzf", artifact.path, "-C", vendorDir], {
    stdio: "inherit"
  });

  const summary = await verifySnapshot(artifact.contractVersion);
  printSummary("Synced hugo-ui AI contract snapshot", {
    ...summary,
    artifact: artifact.path
  });
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

function artifactFromLocalFile(filePath) {
  const artifactPath = path.resolve(filePath);
  return {
    path: artifactPath,
    contractVersion: parseArtifactVersion(path.basename(artifactPath))
  };
}

async function downloadReleaseArtifact(tempDirPath, parsedArgs) {
  const repo = parsedArgs.repo;
  const tag = parsedArgs.tag;

  if (!repo || !tag) {
    throw new Error(
      "Missing --repo or --tag. Example: npm run contract:sync:hugo-ui -- --repo <owner>/hugo-ui --tag mui-ai-contract-v<version>"
    );
  }

  const tagVersion = parseTagVersion(String(tag));
  const expectedAssetName = `hugo-ui-mui-ai-contract-v${tagVersion}.tgz`;
  const release = await fetchJson(
    `https://api.github.com/repos/${repo}/releases/tags/${tag}`
  );
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const tgzAsset = assets.find((asset) => asset.name === expectedAssetName);
  const checksumAsset = assets.find(
    (asset) => asset.name === `${expectedAssetName}.sha256`
  );

  if (!tgzAsset) {
    throw new Error(
      `No ${expectedAssetName} asset found for ${repo}@${tag}. Release tag and artifact version must match.`
    );
  }

  if (!checksumAsset) {
    throw new Error(`No ${expectedAssetName}.sha256 asset found for ${repo}@${tag}.`);
  }

  const tgzPath = path.join(tempDirPath, tgzAsset.name);
  const checksumPath = path.join(tempDirPath, checksumAsset.name);

  await downloadFile(tgzAsset.browser_download_url, tgzPath);
  await downloadFile(checksumAsset.browser_download_url, checksumPath);

  return {
    path: tgzPath,
    contractVersion: tagVersion
  };
}

async function resolveChecksumPath(artifactPath, tempDirPath, parsedArgs) {
  if (parsedArgs["sha256-file"]) {
    return path.resolve(String(parsedArgs["sha256-file"]));
  }

  const adjacent = `${artifactPath}.sha256`;
  if (await exists(adjacent)) {
    return adjacent;
  }

  const downloaded = path.join(tempDirPath, `${path.basename(artifactPath)}.sha256`);
  if (await exists(downloaded)) {
    return downloaded;
  }

  return undefined;
}

async function verifySnapshot(expectedContractVersion) {
  for (const relativePath of requiredFiles) {
    const absolutePath = path.join(vendorDir, relativePath);
    if (!(await exists(absolutePath))) {
      throw new Error(`Missing required vendor snapshot file: ${relativePath}`);
    }
  }

  const manifest = await readJson(path.join(vendorDir, "manifest.json"));
  const provenance = await readJson(path.join(vendorDir, "provenance.json"));

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
    manifest.packageVersion,
    provenance.contractVersion,
    "manifest.packageVersion",
    "provenance.contractVersion"
  );
  assertEqual(
    provenance.packageVersion,
    provenance.contractVersion,
    "provenance.packageVersion",
    "provenance.contractVersion"
  );

  if (expectedContractVersion) {
    assertEqual(
      provenance.contractVersion,
      expectedContractVersion,
      "provenance.contractVersion",
      "release/artifact version"
    );
  }

  const componentNames = (manifest.components ?? []).map(
    (component) => component.componentName
  );
  for (const expectedComponent of ["Button", "Input", "Modal"]) {
    if (!componentNames.includes(expectedComponent)) {
      throw new Error(`Manifest is missing ${expectedComponent}.`);
    }
  }

  return {
    packageName: manifest.packageName,
    packageVersion: manifest.packageVersion,
    contractVersion: provenance.contractVersion,
    sourceCommit: provenance.sourceCommit,
    artifactFormat: provenance.artifactFormat,
    components: componentNames
  };
}

async function verifyChecksum(artifactPath, checksumPath) {
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

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: githubHeaders()
  });

  if (!response.ok) {
    throw new Error(`GitHub request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url, {
    headers: githubHeaders()
  });

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, buffer);
}

function githubHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "design-contract-mcp"
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

function parseArgs(rawArgs) {
  const parsed = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=");
    if (inlineValue !== undefined) {
      parsed[rawKey] = inlineValue;
      continue;
    }

    const next = rawArgs[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[rawKey] = true;
      continue;
    }

    parsed[rawKey] = next;
    index += 1;
  }

  return parsed;
}

function extractSha256(raw) {
  const match = raw.match(/[a-fA-F0-9]{64}/);
  if (!match) {
    throw new Error("Checksum file does not contain a valid SHA-256 hash.");
  }
  return match[0].toLowerCase();
}

function parseTagVersion(tag) {
  const match = tag.match(/^mui-ai-contract-v([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)$/);
  if (!match) {
    throw new Error(
      `Invalid release tag "${tag}". Expected format: mui-ai-contract-v<version>.`
    );
  }
  return match[1];
}

function parseArtifactVersion(fileName) {
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

function assertEqual(actual, expected, actualLabel, expectedLabel) {
  if (actual !== expected) {
    throw new Error(
      `Version mismatch: ${actualLabel} is ${actual}, but ${expectedLabel} is ${expected}.`
    );
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function printSummary(title, summary) {
  console.log(title);
  console.log(JSON.stringify(summary, null, 2));
}
