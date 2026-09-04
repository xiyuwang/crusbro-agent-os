import { E2BTemplateConfig } from './types';

/**
 * Build E2B custom templates.
 * Uses E2B Template API to create pre-configured sandbox environments.
 */
export class E2BTemplateBuilder {
  /**
   * Build a template from config.
   * @returns Build result containing templateId
   */
  static async build(
    config: E2BTemplateConfig,
    opts?: { apiKey?: string; onLog?: (log: string) => void }
  ): Promise<{ templateId: string; alias: string }> {
    const { Template } = await import('e2b');

    let template: any;

    switch (config.base) {
      case 'python':
        template = Template().fromPythonImage(config.baseVersion || '3');
        break;
      case 'node':
        template = Template().fromNodeImage(config.baseVersion || '20');
        break;
      case 'debian':
        template = Template().fromDebianImage(config.baseVersion);
        break;
      case 'ubuntu':
        template = Template().fromUbuntuImage(config.baseVersion);
        break;
      case 'custom':
        if (!config.dockerfile) throw new Error('Custom base requires dockerfile content');
        template = Template().fromDockerfile(config.dockerfile);
        break;
      default:
        template = Template().fromBaseImage();
    }

    if (config.aptPackages?.length) {
      template = template.aptInstall(config.aptPackages);
    }

    if (config.pipPackages?.length) {
      template = template.pipInstall(config.pipPackages);
    }

    if (config.npmPackages?.length) {
      template = template.npmInstall(config.npmPackages, { g: true });
    }

    if (config.buildCommands?.length) {
      template = template.runCmd(config.buildCommands);
    }

    if (config.workDir) {
      template = template.setWorkdir(config.workDir);
    }

    const buildInfo = await Template.build(template, {
      alias: config.alias,
      cpuCount: config.cpuCount || 2,
      memoryMB: config.memoryMB || 512,
      apiKey: opts?.apiKey,
      onBuildLogs: opts?.onLog ? (log: any) => opts.onLog!(String(log)) : undefined,
    });

    return {
      templateId: buildInfo.templateId || config.alias,
      alias: config.alias,
    };
  }

  /**
   * Check if a template alias already exists.
   */
  static async exists(alias: string, opts?: { apiKey?: string }): Promise<boolean> {
    const { Template } = await import('e2b');
    return await Template.aliasExists(alias, { apiKey: opts?.apiKey });
  }
}
