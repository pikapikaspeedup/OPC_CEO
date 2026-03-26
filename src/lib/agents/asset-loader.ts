import fs from 'fs';
import path from 'path';
import { createLogger } from '../logger';
import type { GroupAsset, ReviewPolicyAsset } from './asset-types';
import type { GroupDefinition } from './group-types';
import type { TemplateDefinition } from './pipeline-types';
import { GLOBAL_ASSETS_DIR } from './gateway-home';

const log = createLogger('AssetLoader');

// Priority: global assets dir (AG_GATEWAY_HOME) → fallback to workspace-local
const ASSETS_DIR = fs.existsSync(path.join(GLOBAL_ASSETS_DIR, 'templates'))
  ? GLOBAL_ASSETS_DIR
  : path.join(process.cwd(), '.agents', 'assets');

// ---------------------------------------------------------------------------
// Template cache (Preserved across Next.js HMR)
// ---------------------------------------------------------------------------
const globalForLoader = globalThis as unknown as {
  __AGENT_ASSET_LOADER_TEMPLATES?: TemplateDefinition[];
};

let templateCache: TemplateDefinition[] | null = globalForLoader.__AGENT_ASSET_LOADER_TEMPLATES || null;

function loadTemplates(): TemplateDefinition[] {
  const templatesDir = path.join(ASSETS_DIR, 'templates');
  const templates: TemplateDefinition[] = [];

  if (!fs.existsSync(templatesDir)) {
    log.debug('No templates directory found, using fallback');
    return [];
  }

  try {
    const files = fs.readdirSync(templatesDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(templatesDir, file), 'utf-8');
      const def = JSON.parse(content) as TemplateDefinition;
      if (def.kind === 'template' && def.id && def.groups) {
        templates.push(def);
      }
    }
    log.info({ count: templates.length }, 'Templates loaded from disk');
  } catch (err: any) {
    log.error({ err: err.message }, 'Failed to load templates');
  }

  return templates;
}

// ---------------------------------------------------------------------------
// Fallback groups — used ONLY when no template files exist
// ---------------------------------------------------------------------------

const FALLBACK_GROUPS: GroupDefinition[] = [
  {
    id: 'coding-basic',
    title: 'Coding Worker',
    description: 'Single dev-worker.',
    templateId: 'coding-basic-template',
    executionMode: 'legacy-single',
    capabilities: { acceptsEnvelope: false, emitsManifest: false, advisory: false },
    roles: [{ id: 'dev-worker', workflow: '/dev-worker', timeoutMs: 20 * 60 * 1000, autoApprove: true }],
    defaultModel: 'MODEL_PLACEHOLDER_M26',
  },
  {
    id: 'product-spec',
    title: '产品规格',
    description: 'PM author drafts spec, lead reviewer validates.',
    templateId: 'development-template-1',
    executionMode: 'review-loop',
    capabilities: { acceptsEnvelope: true, emitsManifest: true, advisory: true },
    roles: [
      { id: 'pm-author', workflow: '/pm-author', timeoutMs: 10 * 60 * 1000, autoApprove: true },
      { id: 'product-lead-reviewer', workflow: '/product-lead-reviewer', timeoutMs: 8 * 60 * 1000, autoApprove: true },
    ],
    reviewPolicyId: 'default-product',
    defaultModel: 'MODEL_PLACEHOLDER_M26',
  },
  {
    id: 'architecture-advisory',
    title: '架构顾问',
    description: 'Architecture author drafts plan, reviewer validates.',
    templateId: 'development-template-1',
    executionMode: 'review-loop',
    capabilities: { acceptsEnvelope: true, emitsManifest: true, requiresInputArtifacts: true, advisory: true },
    sourceContract: {
      acceptedSourceGroupIds: ['product-spec'],
      requireReviewOutcome: ['approved'],
      autoBuildInputArtifactsFromSources: true
    },
    roles: [
      { id: 'architect-author', workflow: '/architect-author', timeoutMs: 12 * 60 * 1000, autoApprove: true },
      { id: 'architecture-reviewer', workflow: '/architecture-reviewer', timeoutMs: 10 * 60 * 1000, autoApprove: true },
    ],
    reviewPolicyId: 'default-architecture',
    defaultModel: 'MODEL_PLACEHOLDER_M26',
  },
  {
    id: 'autonomous-dev-pilot',
    title: '自主开发试点',
    description: 'Autonomous dev team.',
    templateId: 'development-template-1',
    executionMode: 'delivery-single-pass',
    capabilities: { acceptsEnvelope: true, emitsManifest: true, requiresInputArtifacts: true, delivery: true },
    sourceContract: {
      acceptedSourceGroupIds: ['architecture-advisory'],
      requireReviewOutcome: ['approved'],
      autoIncludeUpstreamSourceRuns: true,
      autoBuildInputArtifactsFromSources: true,
    },
    roles: [{ id: 'autonomous-dev', workflow: '/autonomous-dev', timeoutMs: 30 * 60 * 1000, autoApprove: true }],
    defaultModel: 'MODEL_PLACEHOLDER_M26',
  },
  {
    id: 'ux-review',
    title: '产品体验评审',
    description: 'UX Review Author + Critic, 3-round adversarial review.',
    templateId: 'design-review-template',
    executionMode: 'review-loop',
    capabilities: { acceptsEnvelope: true, emitsManifest: true, advisory: true },
    roles: [
      { id: 'ux-review-author', workflow: '/ux-review-author', timeoutMs: 12 * 60 * 1000, autoApprove: true },
      { id: 'ux-review-critic', workflow: '/ux-review-critic', timeoutMs: 10 * 60 * 1000, autoApprove: true },
    ],
    reviewPolicyId: 'default-strict',
    defaultModel: 'MODEL_PLACEHOLDER_M26',
  },
];

// ---------------------------------------------------------------------------
// AssetLoader
// ---------------------------------------------------------------------------

export class AssetLoader {
  /**
   * Load all templates from .agents/assets/templates/
   */
  static loadAllTemplates(): TemplateDefinition[] {
    if (!templateCache) {
      templateCache = loadTemplates();
      if (process.env.NODE_ENV !== 'production' && templateCache.length > 0) {
        globalForLoader.__AGENT_ASSET_LOADER_TEMPLATES = templateCache;
      }
    }
    return templateCache;
  }

  /**
   * Get a specific template by ID
   */
  static getTemplate(templateId: string): TemplateDefinition | null {
    return AssetLoader.loadAllTemplates().find(t => t.id === templateId) ?? null;
  }

  /**
   * Load all groups — flattened from templates.
   * This maintains backward compatibility with group-registry.ts
   */
  static loadAllGroups(): GroupDefinition[] {
    const templates = AssetLoader.loadAllTemplates();

    if (templates.length === 0) {
      // No template files on disk — use fallbacks
      return FALLBACK_GROUPS;
    }

    const groups: GroupDefinition[] = [];
    const seen = new Set<string>();

    for (const template of templates) {
      for (const [groupId, groupDef] of Object.entries(template.groups)) {
        if (seen.has(groupId)) continue; // first template wins for duplicate groupIds
        seen.add(groupId);
        groups.push({
          ...groupDef,
          id: groupId,
          templateId: template.id,
          defaultModel: (groupDef as any).defaultModel || template.defaultModel || 'MODEL_PLACEHOLDER_M26',
        } as GroupDefinition);
      }
    }

    return groups;
  }

  static getReviewPolicy(id: string): ReviewPolicyAsset | null {
    const policyPath = path.join(ASSETS_DIR, 'review-policies', `${id}.json`);
    if (fs.existsSync(policyPath)) {
      try {
        const content = fs.readFileSync(policyPath, 'utf-8');
        return JSON.parse(content) as ReviewPolicyAsset;
      } catch (err: any) {
        log.error({ err: err.message, id }, 'Failed to load review policy');
      }
    }

    // Default fallback policies
    if (id === 'default-strict') {
      return {
        id: 'default-strict',
        kind: 'review-policy',
        rules: [{ conditions: [{ field: 'round', operator: 'gt', value: 3 }], outcome: 'revise-exhausted' }],
        fallbackDecision: 'approved',
      };
    }
    return null;
  }

  /**
   * Resolve a workflow path (e.g. "/dev-worker") to its markdown content.
   * Looks in ASSETS_DIR/workflows/{name}.md.
   * Returns the file content or the original path string if not found.
   */
  static resolveWorkflowContent(workflowPath: string): string {
    if (!workflowPath.startsWith('/')) return workflowPath;
    const name = workflowPath.slice(1); // strip leading /
    const mdPath = path.join(ASSETS_DIR, 'workflows', `${name}.md`);
    try {
      if (fs.existsSync(mdPath)) {
        const content = fs.readFileSync(mdPath, 'utf-8');
        log.debug({ workflow: name, length: content.length }, 'Workflow content resolved');
        return content;
      }
    } catch (err: any) {
      log.warn({ workflow: name, err: err.message }, 'Failed to read workflow file');
    }
    return workflowPath;
  }

  /**
   * Clear template cache (useful after config changes)
   */
  static reloadTemplates(): void {
    templateCache = null;
  }
}
