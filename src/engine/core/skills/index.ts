/**
 * Skills 模块导出
 */

// 路径2: Agent使用（现有模块）
export { SkillsManager } from './manager';
export type { SkillMetadata, SkillContent, SandboxConfig } from './types';
export { generateSkillsMetadataXml } from './xml-generator';

// 路径1: 技能管理（新增模块）
export { SkillsManagementManager } from './management-manager';
export { OperationQueue, OperationType, OperationStatus } from './operation-queue';
export { SandboxFileManager } from './sandbox-file-manager';
export type {
  SkillInfo,
  SkillDetail,
  SkillFileTree,
  CreateSkillOptions,
  ArchivedSkillInfo,
} from './types';
