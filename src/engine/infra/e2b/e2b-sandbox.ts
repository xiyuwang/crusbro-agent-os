import { Sandbox as E2BSdk } from 'e2b';
import { Sandbox, SandboxKind, SandboxFS, SandboxExecResult } from '../sandbox';
import { E2BSandboxOptions } from './types';
import { E2BFS, E2BFSHost } from './e2b-fs';

export class E2BSandbox implements Sandbox, E2BFSHost {
  kind: SandboxKind = 'e2b';
  workDir: string;
  fs: SandboxFS;

  private e2b: E2BSdk | null = null;
  private options: E2BSandboxOptions;
  private watchers = new Map<string, { stop: () => Promise<void> }>();

  constructor(options: E2BSandboxOptions = {}) {
    this.options = options;
    this.workDir = options.workDir || '/home/user';
    this.fs = new E2BFS(this);
  }

  /** Initialize sandbox connection (create or resume) */
  async init(): Promise<void> {
    if (this.options.sandboxId) {
      this.e2b = await E2BSdk.connect(this.options.sandboxId, {
        apiKey: this.options.apiKey,
        domain: this.options.domain,
      });
    } else {
      this.e2b = await E2BSdk.create(this.options.template || 'base', {
        apiKey: this.options.apiKey,
        timeoutMs: this.options.timeoutMs || 300_000,
        envs: this.options.envs,
        metadata: this.options.metadata,
        domain: this.options.domain,
      });
    }
  }

  /** Get underlying E2B SDK instance */
  getE2BInstance(): E2BSdk {
    if (!this.e2b) throw new Error('E2BSandbox not initialized. Call init() first.');
    return this.e2b;
  }

  /** Get sandbox ID (for persistence and resume) */
  getSandboxId(): string {
    return this.getE2BInstance().sandboxId;
  }

  /** Get accessible URL for a given port */
  getHostUrl(port: number): string {
    return `https://${this.getE2BInstance().getHost(port)}`;
  }

  async exec(cmd: string, opts?: { timeoutMs?: number }): Promise<SandboxExecResult> {
    const e2b = this.getE2BInstance();
    const timeout = opts?.timeoutMs || this.options.execTimeoutMs || 120_000;

    try {
      const result = await this.withRetry(() =>
        e2b.commands.run(cmd, {
          cwd: this.workDir,
          timeoutMs: timeout,
        })
      );
      return {
        code: result.exitCode,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
      };
    } catch (error: any) {
      if (error.exitCode !== undefined) {
        return {
          code: error.exitCode,
          stdout: error.stdout || '',
          stderr: error.stderr || error.message || '',
        };
      }
      return {
        code: 1,
        stdout: '',
        stderr: error.message || 'E2B command execution failed',
      };
    }
  }

  async watchFiles(
    paths: string[],
    listener: (event: { path: string; mtimeMs: number }) => void
  ): Promise<string> {
    const e2b = this.getE2BInstance();
    const id = `e2b-watch-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // E2B watchDir is directory-based, group paths by parent directory
    const dirs = [...new Set(paths.map((p) => {
      const resolved = this.fs.resolve(p);
      return resolved.replace(/\/[^/]+$/, '') || '/';
    }))];

    const handles: Array<{ stop: () => Promise<void> }> = [];
    for (const dir of dirs) {
      const handle = await e2b.files.watchDir(dir, (event: any) => {
        const fullPath = `${dir}/${event.name}`.replace(/\/+/g, '/');
        listener({ path: fullPath, mtimeMs: Date.now() });
      }, { recursive: true });
      handles.push(handle);
    }

    this.watchers.set(id, {
      stop: async () => {
        for (const h of handles) await h.stop();
      },
    });
    return id;
  }

  unwatchFiles(id: string): void {
    const entry = this.watchers.get(id);
    if (entry) {
      entry.stop().catch(() => {});
      this.watchers.delete(id);
    }
  }

  async dispose(): Promise<void> {
    for (const entry of this.watchers.values()) {
      await entry.stop().catch(() => {});
    }
    this.watchers.clear();

    if (this.e2b) {
      await this.e2b.kill();
      this.e2b = null;
    }
  }

  /** Extend sandbox lifetime */
  async setTimeout(timeoutMs: number): Promise<void> {
    await this.getE2BInstance().setTimeout(timeoutMs);
  }

  /** Check if sandbox is running */
  async isRunning(): Promise<boolean> {
    try {
      return await this.getE2BInstance().isRunning();
    } catch {
      return false;
    }
  }

  /** Custom JSON serialization to avoid circular reference */
  toJSON(): Record<string, unknown> {
    return {
      kind: this.kind,
      workDir: this.workDir,
      sandboxId: this.e2b?.sandboxId ?? null,
      template: this.options.template,
    };
  }

  private async withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error: any) {
        const isRateLimit = error.name === 'RateLimitError' || error.status === 429;
        if (isRateLimit && i < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, Math.pow(2, i) * 1000));
          continue;
        }
        throw error;
      }
    }
    throw new Error('Max retries exceeded');
  }
}
