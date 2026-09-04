import { SandboxFS } from '../sandbox';

export interface E2BFSHost {
  workDir: string;
  getE2BInstance(): any;
}

export class E2BFS implements SandboxFS {
  constructor(private host: E2BFSHost) {}

  resolve(p: string): string {
    if (p.startsWith('/')) return p;
    return `${this.host.workDir}/${p}`.replace(/\/+/g, '/');
  }

  isInside(_p: string): boolean {
    // E2B sandbox is fully isolated, all paths are safe
    return true;
  }

  async read(p: string): Promise<string> {
    const e2b = this.host.getE2BInstance();
    const resolved = this.resolve(p);
    return await e2b.files.read(resolved, { format: 'text' });
  }

  async write(p: string, content: string): Promise<void> {
    const e2b = this.host.getE2BInstance();
    const resolved = this.resolve(p);

    // Ensure parent directory exists
    const dir = resolved.replace(/\/[^/]+$/, '');
    if (dir && dir !== '/') {
      await e2b.commands.run(`mkdir -p "${dir}"`, { timeoutMs: 5000 }).catch(() => {});
    }

    await e2b.files.write(resolved, content);
  }

  temp(name?: string): string {
    const tempName = name || `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    return `/tmp/${tempName}`;
  }

  async stat(p: string): Promise<{ mtimeMs: number }> {
    const e2b = this.host.getE2BInstance();
    const resolved = this.resolve(p);
    const info = await e2b.files.getInfo(resolved);
    return { mtimeMs: info.modifiedTime?.getTime() || Date.now() };
  }

  async glob(
    pattern: string,
    opts?: { cwd?: string; ignore?: string[]; dot?: boolean; absolute?: boolean }
  ): Promise<string[]> {
    const cwd = opts?.cwd ? this.resolve(opts.cwd) : this.host.workDir;

    // Strategy 1: prefer find command (better performance)
    try {
      return await this.globViaFind(pattern, cwd, opts);
    } catch {
      // Strategy 2: fallback to files.list recursion
      return await this.globViaList(pattern, cwd, opts);
    }
  }

  private async globViaFind(
    pattern: string,
    cwd: string,
    opts?: { ignore?: string[]; dot?: boolean; absolute?: boolean }
  ): Promise<string[]> {
    const e2b = this.host.getE2BInstance();

    const findPattern = this.globToFindPattern(pattern);
    let cmd = `find "${cwd}" ${findPattern} -type f`;

    if (!opts?.dot) {
      cmd += ' -not -path "*/.*"';
    }

    if (opts?.ignore?.length) {
      for (const ig of opts.ignore) {
        cmd += ` -not -path "${ig}"`;
      }
    }

    const result = await e2b.commands.run(cmd, { timeoutMs: 30_000 });
    if (result.exitCode !== 0) throw new Error(result.stderr);

    const paths = result.stdout.split('\n').filter(Boolean);

    if (opts?.absolute) return paths;
    return paths.map((p: string) => {
      const rel = p.startsWith(cwd) ? p.slice(cwd.length).replace(/^\//, '') : p;
      return rel;
    });
  }

  private async globViaList(
    pattern: string,
    cwd: string,
    opts?: { ignore?: string[]; dot?: boolean; absolute?: boolean }
  ): Promise<string[]> {
    const e2b = this.host.getE2BInstance();
    const results: string[] = [];

    const walk = async (dir: string) => {
      let entries: any[];
      try {
        entries = await e2b.files.list(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = `${dir}/${entry.name}`.replace(/\/+/g, '/');

        if (!opts?.dot && entry.name.startsWith('.')) continue;

        const rel = fullPath.startsWith(cwd)
          ? fullPath.slice(cwd.length).replace(/^\//, '')
          : fullPath;

        if (this.matchGlob(pattern, rel)) {
          const ignored = opts?.ignore?.some((ig) => this.matchGlob(ig, rel));
          if (!ignored) {
            results.push(opts?.absolute ? fullPath : rel);
          }
        }

        if (entry.type === 'dir') {
          await walk(fullPath);
        }
      }
    };

    await walk(cwd);
    return results;
  }

  /** @internal */
  globToFindPattern(pattern: string): string {
    if (pattern.includes('/')) {
      const findPat = pattern.replace(/\*\*/g, '*');
      return `-path "*/${findPat}"`;
    }
    return `-name "${pattern}"`;
  }

  /** @internal */
  matchGlob(pattern: string, target: string): boolean {
    const regex = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\?/g, '.')
      .replace(/\*\*\//g, '<<<GLOBSTAR_SLASH>>>')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/<<<GLOBSTAR_SLASH>>>/g, '(.*/)?');
    return new RegExp(`^${regex}$`).test(target);
  }
}
