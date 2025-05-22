/**
 * Mock utilities for Git LFS operations in tests
 * Used to simulate Git LFS without requiring an actual installation
 */

/**
 * Mock Git LFS class
 * Used to simulate Git LFS commands in tests
 */
export class MockGitLFS {
  private _isInstalled = true;
  private _trackedPaths: Set<string> = new Set();

  /**
   * Set whether Git LFS is "installed"
   */
  setInstalled(isInstalled: boolean): void {
    this._isInstalled = isInstalled;
  }

  /**
   * Check if Git LFS is "installed"
   */
  isInstalled(): boolean {
    return this._isInstalled;
  }

  /**
   * Mock the "git lfs install" command
   */
  install(repoPath: string): string {
    if (!this._isInstalled) {
      throw new Error("Git LFS not installed");
    }

    return "Git LFS initialized.";
  }

  /**
   * Mock the "git lfs track" command
   */
  track(pattern: string, repoPath: string): string {
    if (!this._isInstalled) {
      throw new Error("Git LFS not installed");
    }

    this._trackedPaths.add(pattern);
    return `Tracking "${pattern}"`;
  }

  /**
   * Mock the "git lfs untrack" command
   */
  untrack(pattern: string, repoPath: string): string {
    if (!this._isInstalled) {
      throw new Error("Git LFS not installed");
    }

    if (this._trackedPaths.has(pattern)) {
      this._trackedPaths.delete(pattern);
      return `Untracking "${pattern}"`;
    }

    return `Pattern "${pattern}" is not being tracked.`;
  }

  /**
   * Check if a pattern is being tracked
   */
  isTracked(pattern: string): boolean {
    return this._trackedPaths.has(pattern);
  }

  /**
   * Get all tracked patterns
   */
  getTrackedPatterns(): string[] {
    return Array.from(this._trackedPaths);
  }
}

/**
 * Create a pre-configured mock Git LFS instance
 */
export function createMockGitLFS(): MockGitLFS {
  return new MockGitLFS();
}
