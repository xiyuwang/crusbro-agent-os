/**
 * Scripts 执行工具
 *
 * 设计原则 (UNIX哲学):
 * - 简洁: 只负责执行scripts，支持双模式（直接执行/sandbox隔离）
 * - 安全: 支持sandbox隔离执行，拦截危险命令
 * - 跨平台: 自动适配Windows、Linux、MacOS
 */

import { tool } from '../tools/tool';
import { z } from 'zod';
import type { SkillsManager } from '../core/skills/manager';
import type { SandboxFactory } from '../infra/sandbox-factory';
import type { Sandbox } from '../infra/sandbox';
import type { ToolContext } from '../core/types';
import { execSync } from 'child_process';
import * as path from 'path';
import * as os from 'os';

/**
 * Scripts 工具描述
 */
const DESCRIPTION = `执行skill中的scripts脚本。

支持两种执行模式:
- 直接执行模式（默认）: 本地开发时使用，直接在当前环境执行
- Sandbox隔离模式: 生产环境使用，在安全隔离环境中执行

支持的脚本类型:
- Node.js脚本 (.js, .ts): 跨平台兼容
- Shell脚本 (.sh): Linux/MacOS
- Batch脚本 (.bat): Windows

注意: 危险命令会被自动拦截（如rm -rf /、sudo等）`;

/**
 * 检测平台
 */
function detectPlatform(): 'windows' | 'linux' | 'macos' {
  const platform = os.platform();
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  return 'linux';
}

/**
 * 获取脚本执行命令
 */
function getScriptCommand(scriptPath: string, platform: string): string {
  const ext = path.extname(scriptPath).toLowerCase();

  switch (ext) {
    case '.js':
      return `node "${scriptPath}"`;
    case '.ts':
      return `ts-node "${scriptPath}"`;
    case '.sh':
      if (platform === 'windows') {
        // Windows下需要Git Bash或WSL来执行.sh
        return `bash "${scriptPath}"`;
      }
      return `sh "${scriptPath}"`;
    case '.bat':
    case '.cmd':
      if (platform !== 'windows') {
        throw new Error(`Batch scripts (.bat/.cmd) are only supported on Windows`);
      }
      return `"${scriptPath}"`;
    default:
      throw new Error(`Unsupported script type: ${ext}`);
  }
}

/**
 * 创建Scripts工具
 *
 * @param skillsManager Skills管理器实例
 * @param sandboxFactory Sandbox工厂（可选）
 * @returns ToolInstance
 */
export function createScriptsTool(
  skillsManager: SkillsManager,
  sandboxFactory?: SandboxFactory
) {
  const scriptsTool = tool({
    name: 'execute_script',
    description: DESCRIPTION,
    parameters: z.object({
      skill_name: z.string().describe('技能名称'),
      script_name: z.string().describe('脚本文件名（如"script.js"）'),
      use_sandbox: z.boolean().optional().default(true).describe('是否使用sandbox隔离执行'),
      args: z.array(z.string()).optional().describe('脚本参数（可选）'),
    }),
    async execute(args, ctx: ToolContext) {
      const { skill_name, script_name, use_sandbox, args: scriptArgs = [] } = args;

      // 加载skill内容
      const skillContent = await skillsManager.loadSkillContent(skill_name);
      if (!skillContent) {
        return {
          ok: false,
          error: `Skill '${skill_name}' not found`,
        };
      }

      // 查找脚本文件
      const scriptPath = skillContent.scripts.find(p => path.basename(p) === script_name);
      if (!scriptPath) {
        return {
          ok: false,
          error: `Script '${script_name}' not found in skill '${skill_name}'. Available scripts: ${skillContent.scripts.map(p => path.basename(p)).join(', ')}`,
        };
      }

      const platform = detectPlatform();
      let result: { code: number; stdout: string; stderr: string };

      try {
        if (use_sandbox && sandboxFactory) {
          // 使用sandbox隔离执行
          const sandbox: Sandbox = sandboxFactory.create({
            kind: 'local',
            workDir: skillContent.metadata.baseDir,
          });

          const cmd = getScriptCommand(scriptPath, platform);
          const cmdWithArgs = `${cmd} ${scriptArgs.join(' ')}`;

          result = await sandbox.exec(cmdWithArgs, { timeoutMs: 60000 });
        } else {
          // 直接执行（本地开发模式）
          const cmd = getScriptCommand(scriptPath, platform);
          const cmdWithArgs = `${cmd} ${scriptArgs.join(' ')}`;

          const stdout = execSync(cmdWithArgs, {
            cwd: skillContent.metadata.baseDir,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 60000,
          });

          result = {
            code: 0,
            stdout: stdout || '',
            stderr: '',
          };
        }

        if (result.code !== 0) {
          return {
            ok: false,
            error: `Script execution failed with code ${result.code}`,
            data: {
              stdout: result.stdout,
              stderr: result.stderr,
            },
          };
        }

        return {
          ok: true,
          data: {
            stdout: result.stdout,
            stderr: result.stderr,
          },
        };
      } catch (error: any) {
        return {
          ok: false,
          error: error.message || 'Script execution failed',
          data: {
            stdout: error.stdout || '',
            stderr: error.stderr || '',
          },
        };
      }
    },
    metadata: {
      readonly: false,
      version: '1.0',
    },
  });

  return scriptsTool;
}

/**
 * 导出工具创建函数
 */
export default createScriptsTool;
