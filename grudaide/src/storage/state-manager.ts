/**
 * GRUDAIDE - State Manager
 * Higher-level state management built on top of GitHubStorage
 */

import { createLogger } from "../utils/logger";
import { GitHubStorage } from "./github-storage";

const logger = createLogger("state-manager");

export interface StateValue {
  [key: string]: unknown;
}

export class StateManager {
  private readonly KEY_PREFIX = "state/";

  constructor(private readonly storage: GitHubStorage) {}

  /**
   * Read a named state object, returning defaultState if not found.
   */
  async getState<T extends StateValue>(
    name: string,
    defaultState: T
  ): Promise<T> {
    const record = await this.storage.get<T>(`${this.KEY_PREFIX}${name}`);
    if (!record) {
      logger.debug(`State "${name}" not found, returning default`);
      return defaultState;
    }
    return record.value;
  }

  /**
   * Persist a named state object.
   */
  async setState<T extends StateValue>(name: string, state: T): Promise<void> {
    await this.storage.set(`${this.KEY_PREFIX}${name}`, state);
    logger.debug(`State "${name}" saved`);
  }

  /**
   * Partially update a named state object (shallow merge).
   */
  async patchState<T extends StateValue>(
    name: string,
    patch: Partial<T>,
    defaultState: T
  ): Promise<T> {
    const current = await this.getState<T>(name, defaultState);
    const next = { ...current, ...patch };
    await this.setState(name, next);
    return next;
  }

  /**
   * Delete a named state.
   */
  async deleteState(name: string): Promise<boolean> {
    return this.storage.delete(`${this.KEY_PREFIX}${name}`);
  }

  /**
   * List all state names.
   */
  async listStates(): Promise<string[]> {
    const keys = await this.storage.listKeys();
    return keys
      .filter((k) => k.startsWith(this.KEY_PREFIX))
      .map((k) => k.slice(this.KEY_PREFIX.length));
  }
}
