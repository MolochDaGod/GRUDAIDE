/**
 * GRUDAIDE - npm Environment Manager
 * Manages npm environments for Grudge Studio projects
 */

import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import { createLogger } from "../utils/logger";
import { DeploymentError } from "../utils/errors";
import { withRetry } from "../utils/errors";

const execFileAsync = promisify(execFile);
const logger = createLogger("npm-env");

export interface NpmProject {
  name: string;
  /** Absolute path to the project root */
  path: string;
  /** Optional private registry URL */
  registry?: string;
}

export interface NpmRunOptions {
  /** Working directory (defaults to project.path) */
  cwd?: string;
  /** Additional environment variables */
  env?: NodeJS.ProcessEnv;
  /** Timeout in ms (default 120 000) */
  timeout?: number;
}

export interface NpmRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class NpmEnvironmentManager {
  private readonly npmToken?: string;
  private readonly defaultRegistry?: string;

  constructor(options?: { npmToken?: string; defaultRegistry?: string }) {
    this.npmToken = options?.npmToken;
    this.defaultRegistry = options?.defaultRegistry;
  }

  // ─── Low-level runner ───────────────────────────────────────────────────

  /**
   * Run an npm command and return stdout/stderr.
   */
  async run(
    args: string[],
    options: NpmRunOptions = {}
  ): Promise<NpmRunResult> {
    const { cwd = process.cwd(), env, timeout = 120_000 } = options;
    const effectiveEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...(this.npmToken ? { NPM_TOKEN: this.npmToken } : {}),
      ...(this.defaultRegistry ? { NPM_CONFIG_REGISTRY: this.defaultRegistry } : {}),
      ...env,
    };

    try {
      const { stdout, stderr } = await execFileAsync("npm", args, {
        cwd,
        env: effectiveEnv,
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
      });
      return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      logger.error(`npm ${args[0]} failed`, { cwd, args, stderr: e.stderr });
      throw new DeploymentError(`npm ${args.join(" ")} failed: ${e.stderr ?? String(err)}`, {
        cwd,
        args,
        stderr: e.stderr,
        exitCode: e.code,
      });
    }
  }

  // ─── High-level project helpers ─────────────────────────────────────────

  /** npm install in the project directory */
  async install(project: NpmProject, options?: NpmRunOptions): Promise<void> {
    logger.info(`Installing dependencies for ${project.name}`);
    const args = ["install", "--prefer-offline"];
    if (project.registry) args.push(`--registry=${project.registry}`);
    await this.run(args, { cwd: project.path, ...options });
    logger.info(`Dependencies installed for ${project.name}`);
  }

  /** npm run <script> in the project directory */
  async runScript(
    project: NpmProject,
    script: string,
    options?: NpmRunOptions
  ): Promise<NpmRunResult> {
    logger.info(`Running "${script}" for ${project.name}`);
    const result = await this.run(["run", script], {
      cwd: project.path,
      ...options,
    });
    logger.info(`Script "${script}" completed for ${project.name}`);
    return result;
  }

  /** npm test */
  async test(project: NpmProject, options?: NpmRunOptions): Promise<NpmRunResult> {
    return this.runScript(project, "test", options);
  }

  /** npm run build */
  async build(project: NpmProject, options?: NpmRunOptions): Promise<NpmRunResult> {
    return this.runScript(project, "build", options);
  }

  /** npm publish */
  async publish(
    project: NpmProject,
    tag = "latest",
    options?: NpmRunOptions
  ): Promise<void> {
    logger.info(`Publishing ${project.name} with tag "${tag}"`);
    const args = ["publish", `--tag=${tag}`];
    if (project.registry) args.push(`--registry=${project.registry}`);
    await this.run(args, { cwd: project.path, ...options });
    logger.info(`Published ${project.name}`);
  }

  /** Read package.json from a project and return its version field */
  async getVersion(project: NpmProject): Promise<string> {
    const pkgPath = path.join(project.path, "package.json");
    if (!fs.existsSync(pkgPath)) {
      throw new DeploymentError(`package.json not found at ${pkgPath}`, {
        project: project.name,
      });
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  }

  /** Bump the package version using npm version */
  async bumpVersion(
    project: NpmProject,
    release: "patch" | "minor" | "major" | string,
    options?: NpmRunOptions
  ): Promise<string> {
    await this.run(["version", release, "--no-git-tag-version"], {
      cwd: project.path,
      ...options,
    });
    return this.getVersion(project);
  }
}
