/**
 * SkillManageTool — 技能管理工具（创建/更新/删除/列表）
 * 实现 Hermes Agent 的自学习闭环：Agent 可以将工作流保存为可复用技能
 */

import { z } from 'zod';
import { SkillStore } from '../engine/skill-store';
import type { Tool, ToolContext, ToolResult } from '../types';

const inputSchema = z.object({
  action: z.enum(['create', 'update', 'delete', 'list', 'search']).describe(
    'Action to perform: create/update/delete/list/search',
  ),
  name: z.string().optional().describe('Skill name (required for create/update/delete)'),
  content: z.string().optional().describe('Skill content in Markdown (required for create/update)'),
  description: z.string().optional().describe('Brief description of what the skill does'),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
  scope: z.enum(['global', 'project']).optional().default('global').describe(
    'global: ~/.claude-engine/skills/, project: <workspace>/.claude/skills/',
  ),
  query: z.string().optional().describe('Search query (for search action)'),
});

type Input = z.infer<typeof inputSchema>;

export const skillManageTool = {
  name: 'SkillManageTool',
  aliases: ['skill_manage', 'manage_skill'],
  inputSchema,
  inputJSONSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'update', 'delete', 'list', 'search'],
        description: 'Action to perform',
      },
      name: { type: 'string', description: 'Skill name' },
      content: { type: 'string', description: 'Skill content in Markdown' },
      description: { type: 'string', description: 'Brief description' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Tags' },
      scope: {
        type: 'string',
        enum: ['global', 'project'],
        description: 'Storage scope',
      },
      query: { type: 'string', description: 'Search query' },
    },
    required: ['action'],
  },
  description: (input: Input) => {
    switch (input.action) {
      case 'create': return `Create skill: ${input.name ?? 'unnamed'}`;
      case 'update': return `Update skill: ${input.name ?? 'unnamed'}`;
      case 'delete': return `Delete skill: ${input.name ?? 'unnamed'}`;
      case 'list': return 'List all skills';
      case 'search': return `Search skills: ${input.query ?? ''}`;
    }
  },

  async call(args: Input, context: ToolContext): Promise<ToolResult<string>> {
    const store = new SkillStore(context.workspacePath);

    switch (args.action) {
      case 'create':
      case 'update': {
        if (!args.name) {
          return { data: 'Error: "name" is required for create/update.' };
        }
        if (!args.content) {
          return { data: 'Error: "content" is required for create/update.' };
        }

        const skill = await store.saveSkill(args.name, args.content, {
          description: args.description,
          tags: args.tags,
          scope: args.scope,
          source: 'learned',
        });

        return {
          data: `Skill "${skill.name}" ${args.action === 'create' ? 'created' : 'updated'} successfully.\n` +
            `Path: ${skill.path}\n` +
            `Scope: ${skill.scope}\n` +
            `Tags: ${skill.metadata.tags.join(', ') || 'none'}`,
        };
      }

      case 'delete': {
        if (!args.name) {
          return { data: 'Error: "name" is required for delete.' };
        }

        const deleted = await store.deleteSkill(args.name, args.scope);
        return {
          data: deleted
            ? `Skill "${args.name}" deleted.`
            : `Skill "${args.name}" not found.`,
        };
      }

      case 'list': {
        const skills = await store.listSkills();
        if (skills.length === 0) {
          return { data: 'No skills found. Use SkillManageTool with action "create" to save a workflow as a skill.' };
        }

        const lines = [`Found ${skills.length} skill(s):`, ''];
        for (const s of skills) {
          const tags = s.metadata.tags.length > 0 ? ` [${s.metadata.tags.join(', ')}]` : '';
          const usage = s.metadata.usageCount > 0 ? ` (used ${s.metadata.usageCount}x)` : '';
          const scope = s.scope === 'project' ? ' 📁' : ' 🌐';
          lines.push(`- **${s.name}**: ${s.description}${tags}${usage}${scope}`);
        }

        return { data: lines.join('\n') };
      }

      case 'search': {
        const query = args.query ?? args.name ?? '';
        if (!query) {
          return { data: 'Error: "query" is required for search.' };
        }

        const results = await store.searchSkills(query);
        if (results.length === 0) {
          return { data: `No skills found matching "${query}".` };
        }

        const lines = [`Found ${results.length} skill(s) matching "${query}":`, ''];
        for (const s of results) {
          lines.push(`- **${s.name}**: ${s.description}`);
          lines.push(`  Path: ${s.path}`);
        }

        return { data: lines.join('\n') };
      }
    }
  },

  isEnabled: () => true,
  isReadOnly: (input: Input) => input.action === 'list' || input.action === 'search',
  isConcurrencySafe: (input: Input) => input.action === 'list' || input.action === 'search',
  isDestructive: (input: Input) => input.action === 'delete',
  maxResultSizeChars: 20_000,
  isSearchOrReadCommand: (input: Input) => ({
    isSearch: input.action === 'search',
    isRead: input.action === 'list',
  }),
} satisfies Tool<Input, string>;
