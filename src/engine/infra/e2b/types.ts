export interface E2BSandboxOptions {
  /** E2B API Key, priority: parameter > env E2B_API_KEY */
  apiKey?: string;

  /** Sandbox template ID or alias, default 'base' */
  template?: string;

  /** Sandbox timeout in ms, default 300_000 (5min), max 24h */
  timeoutMs?: number;

  /** Sandbox working directory, default '/home/user' */
  workDir?: string;

  /** Sandbox environment variables */
  envs?: Record<string, string>;

  /** Custom metadata */
  metadata?: Record<string, string>;

  /** Allow internet access, default true */
  allowInternetAccess?: boolean;

  /** Default command execution timeout in ms, default 120_000 */
  execTimeoutMs?: number;

  /** Connect to existing sandbox by ID (for resume) */
  sandboxId?: string;

  /** E2B API domain, default 'e2b.app' */
  domain?: string;
}

export interface E2BTemplateConfig {
  /** Template alias */
  alias: string;

  /** Base image type */
  base: 'python' | 'node' | 'debian' | 'ubuntu' | 'custom';

  /** Base image version (e.g. '3.11', '20') */
  baseVersion?: string;

  /** Custom Dockerfile content (used when base='custom') */
  dockerfile?: string;

  /** System packages to install via apt */
  aptPackages?: string[];

  /** Python packages to install via pip */
  pipPackages?: string[];

  /** Node.js packages to install via npm */
  npmPackages?: string[];

  /** Commands to run during build */
  buildCommands?: string[];

  /** Working directory */
  workDir?: string;

  /** CPU count, default 2 */
  cpuCount?: number;

  /** Memory in MB, default 512 */
  memoryMB?: number;
}
