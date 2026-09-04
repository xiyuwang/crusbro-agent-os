/**
 * Skills 元数据XML生成器
 *
 * 设计原则 (UNIX哲学):
 * - 简洁: 只负责生成XML格式的skills元数据
 * - 模块化: 单一职责，易于测试和维护
 * - 兼容: 完全兼容openskills项目的XML格式
 */

import type { SkillMetadata } from './types';

/**
 * 生成skills元数据XML格式（参考openskills）
 */
export function generateSkillsMetadataXml(skills: SkillMetadata[]): string {
  if (skills.length === 0) {
    return '';
  }

  const skillTags = skills
    .map(s => `<skill>
<name>${escapeXml(s.name)}</name>
<description>${escapeXml(s.description)}</description>
<location>project</location>
</skill>`)
    .join('\n\n');

  return `
<skills_system priority="1">

## Available Skills

<!-- SKILLS_TABLE_START -->
<usage>
When users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.

How to use skills:
- Invoke: skills(action="load", skill_name="<skill-name>")
- The skill content will load with detailed instructions on how to complete the task
- Base directory provided in output for resolving bundled resources (references/, scripts/, assets/)

Hot Reload:
- Each time you reload a known skill, it will load the latest state of the skill information
- To load a skill, invoke: skills(action="load", skill_name="<skill-name>")
- The skill content will be loaded with the latest state from the skills directory

Usage notes:
- Only use skills listed in <available_skills> below
- Do not invoke a skill that is already loaded in your context
- Each skill invocation is stateless
</usage>

<available_skills>

${skillTags}

</available_skills>
<!-- SKILLS_TABLE_END -->

</skills_system>`;
}

/**
 * 转义XML特殊字符
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
