import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { runToolCall } from "./tools.mjs";

let fixturesRoot;

const sampleProjects = [
  {
    folder: "vite-react-ts-ok",
    packageJson: {
      name: "vite-react-ts-ok",
      version: "1.0.0",
      dependencies: {
        react: "^19.0.0",
        "react-dom": "^19.0.0",
      },
      devDependencies: {
        vite: "^6.0.0",
        typescript: "^5.0.0",
        "@types/react": "^19.0.0",
        "@types/react-dom": "^19.0.0",
      },
    },
  },
  {
    folder: "next-react-ok",
    packageJson: {
      name: "next-react-ok",
      version: "1.0.0",
      dependencies: {
        next: "^15.0.0",
        react: "^19.0.0",
        "react-dom": "^19.0.0",
      },
    },
  },
  {
    folder: "cra-old-react",
    packageJson: {
      name: "cra-old-react",
      version: "1.0.0",
      dependencies: {
        react: "^17.0.2",
        "react-dom": "^17.0.2",
        "react-scripts": "5.0.1",
      },
    },
  },
  {
    folder: "react-dom-version-mismatch",
    packageJson: {
      name: "react-dom-version-mismatch",
      version: "1.0.0",
      dependencies: {
        react: "^18.2.0",
        "react-dom": "^17.0.2",
      },
      devDependencies: {
        vite: "^5.0.0",
      },
    },
  },
  {
    folder: "typescript-missing-react-deps",
    packageJson: {
      name: "typescript-missing-react-deps",
      version: "1.0.0",
      dependencies: {
        react: "^18.2.0",
      },
      devDependencies: {
        vite: "^5.0.0",
        typescript: "^5.0.0",
      },
    },
  },
];

before(async () => {
  fixturesRoot = await mkdtemp(resolve(process.cwd(), "server", ".tmp-tools-"));

  for (const sampleProject of sampleProjects) {
    const projectPath = resolve(fixturesRoot, sampleProject.folder);
    const packageJsonPath = resolve(projectPath, "package.json");

    await mkdir(projectPath, { recursive: true });
    await writeFile(
      packageJsonPath,
      JSON.stringify(sampleProject.packageJson, null, 2),
      "utf-8",
    );
  }
});

after(async () => {
  await rm(fixturesRoot, { recursive: true, force: true });
});

test("analyzes a healthy Vite React TypeScript project", async () => {
  const result = await analyzeSampleProject("vite-react-ts-ok");

  assert.equal(result.project.name, "vite-react-ts-ok");
  assert.equal(result.project.is_react_project, true);
  assert.equal(result.dependencies.react, "^19.0.0");
  assert.equal(result.dependencies.react_dom, "^19.0.0");
  assert.equal(result.dependencies.build_tool, "vite");
  assert.equal(result.dependencies.has_typescript, true);
  assert.equal(result.dependencies.has_react_types, true);
  assert.equal(result.dependencies.has_react_dom_types, true);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.recommendations, []);
  assert.equal(result.summary.issue_count, 0);
  assert.equal(result.summary.risk_level, "low");
});

test("analyzes a Next React project", async () => {
  const result = await analyzeSampleProject("next-react-ok");

  assert.equal(result.project.name, "next-react-ok");
  assert.equal(result.project.is_react_project, true);
  assert.equal(result.dependencies.build_tool, "next");
  assert.equal(result.summary.risk_level, "low");
});

test("detects an old React major version in a Create React App project", async () => {
  const result = await analyzeSampleProject("cra-old-react");
  const codes = getIssueCodes(result);

  assert.equal(result.project.is_react_project, true);
  assert.equal(result.dependencies.build_tool, "create-react-app");
  assert.equal(codes.has("OLD_REACT_MAJOR_VERSION"), true);
  assert.equal(result.summary.risk_level, "medium");
});

test("detects a react and react-dom major version mismatch", async () => {
  const result = await analyzeSampleProject("react-dom-version-mismatch");
  const codes = getIssueCodes(result);

  assert.equal(result.project.is_react_project, true);
  assert.equal(codes.has("REACT_DOM_MAJOR_VERSION_MISMATCH"), true);
  assert.equal(result.summary.risk_level, "high");
});

test("detects missing browser and TypeScript React dependencies", async () => {
  const result = await analyzeSampleProject("typescript-missing-react-deps");
  const codes = getIssueCodes(result);

  assert.equal(result.project.is_react_project, true);
  assert.equal(codes.has("MISSING_REACT_DOM"), true);
  assert.equal(codes.has("MISSING_REACT_TYPES"), true);
  assert.equal(result.summary.risk_level, "medium");
});

async function analyzeSampleProject(folder) {
  const absoluteProjectPath = resolve(fixturesRoot, folder);
  const projectPath = relative(process.cwd(), absoluteProjectPath);

  return runToolCall("analyze_react_project", {
    project_path: projectPath,
  });
}

function getIssueCodes(result) {
  return new Set(result.issues.map((issue) => issue.code));
}
