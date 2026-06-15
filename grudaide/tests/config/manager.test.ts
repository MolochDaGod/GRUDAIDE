/**
 * GRUDAIDE - Config Manager Tests
 */

import * as path from "path";
import { resetConfig, loadConfig } from "../../src/config/manager";

const VALID_CONFIG = path.join(__dirname, "fixtures/valid.config.yml");
const INVALID_CONFIG = path.join(__dirname, "fixtures/invalid.config.yml");

describe("loadConfig", () => {
  // Save and restore env vars that interfere with the config
  let savedNodeEnv: string | undefined;
  let savedOwner: string | undefined;
  let savedRepo: string | undefined;

  beforeEach(() => {
    resetConfig();
    savedNodeEnv = process.env.NODE_ENV;
    savedOwner = process.env.GITHUB_OWNER;
    savedRepo = process.env.GITHUB_REPO;
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_PRIVATE_KEY;
    delete process.env.GITHUB_WEBHOOK_SECRET;
    // Use a valid environment so deployment schema passes
    process.env.NODE_ENV = "development";
    // Clear storage env vars so storage is omitted from env config
    delete process.env.GITHUB_OWNER;
    delete process.env.GITHUB_REPO;
  });

  afterEach(() => {
    resetConfig();
    if (savedNodeEnv !== undefined) process.env.NODE_ENV = savedNodeEnv;
    else delete process.env.NODE_ENV;
    if (savedOwner !== undefined) process.env.GITHUB_OWNER = savedOwner;
    if (savedRepo !== undefined) process.env.GITHUB_REPO = savedRepo;
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_PRIVATE_KEY;
    delete process.env.GITHUB_WEBHOOK_SECRET;
  });

  it("loads from a valid config file", () => {
    const config = loadConfig(VALID_CONFIG);
    expect(config.github.appId).toBe("12345");
    expect(config.server.port).toBe(3000);
  });

  it("merges env vars over file config", () => {
    process.env.GITHUB_APP_ID = "env-app-id";
    process.env.GITHUB_PRIVATE_KEY = "env-key";
    process.env.GITHUB_WEBHOOK_SECRET = "env-secret";
    const config = loadConfig(VALID_CONFIG);
    expect(config.github.appId).toBe("env-app-id");
  });

  it("uses default server port when not configured in env", () => {
    const config = loadConfig(VALID_CONFIG);
    expect(config.server.port).toBe(3000);
  });

  it("throws on invalid config (empty required fields)", () => {
    expect(() => loadConfig(INVALID_CONFIG)).toThrow(/configuration validation failed/i);
  });

  it("caches config after first load", () => {
    const c1 = loadConfig(VALID_CONFIG);
    process.env.GITHUB_APP_ID = "different";
    const c2 = loadConfig(VALID_CONFIG);
    expect(c1).toBe(c2); // Same reference due to cache
  });

  it("normalises unknown NODE_ENV to development", () => {
    process.env.NODE_ENV = "test"; // Jest's default, not a valid deployment env
    const config = loadConfig(VALID_CONFIG);
    expect(config.deployment?.environment).toBe("development");
  });
});
