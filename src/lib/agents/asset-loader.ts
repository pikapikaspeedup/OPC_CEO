import fs from 'fs';
import path from 'path';
import { createLogger } from '../logger';
import type { ReviewPolicyAsset } from './asset-types';
import type { TemplateDefinition } from './pipeline/pipeline-types';
import type { SubgraphDefinition } from './subgraph-types';
import { GLOBAL_ASSETS_DIR } from './gateway-home';
import { validateTemplatePipeline } from './pipeline/pipeline-graph';
import { validateTemplateContracts } from './contract-validator';
import { getOrCompileIR, clearIRCache } from './pipeline/dag-compiler';
import { validateGraphPipeline } from './pipeline/graph-compiler';
import { normalizeTemplateDefinition } from './pipeline/template-normalizer';

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
  __AGENT_ASSET_LOADER_SUBGRAPHS?: SubgraphDefinition[];
};

let templateCache: TemplateDefinition[] | null = globalForLoader.__AGENT_ASSET_LOADER_TEMPLATES || null;
let subgraphCache: SubgraphDefinition[] | null = globalForLoader.__AGENT_ASSET_LOADER_SUBGRAPHS || null;

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
      const raw = JSON.parse(content);
      const def = normalizeTemplateDefinition(raw);
      if (def.kind === 'template' && def.id && (def.pipeline?.length || def.graphPipeline)) {
        // Format detection: graphPipeline takes priority over pipeline[]
        if (def.graphPipeline && def.pipeline?.length) {
          log.warn({ templateId: def.id }, 'Template has both pipeline and graphPipeline; using graphPipeline');
        }

        // Validate based on format
        if (def.graphPipeline) {
          const gErrors = validateGraphPipeline(def.graphPipeline);
          if (gErrors.length > 0) {
            log.error({ templateId: def.id, errors: gErrors }, 'Template graphPipeline validation failed, skipping template');
            continue;
          }
        } else {
          const errors = validateTemplatePipeline(def);
          if (errors.length > 0) {
            log.error({ templateId: def.id, errors }, 'Template DAG validation failed, skipping template');
            continue;
          }
        }
        // Log contract warnings (non-blocking)
        const contractResult = validateTemplateContracts(def);
        if (contractResult.warnings.length > 0) {
          log.warn(
            { templateId: def.id, warnings: contractResult.warnings.map(w => w.message) },
            'Template has contract warnings',
          );
        }
        // Pre-compile IR (populates cache for runtime consumers)
        try {
          getOrCompileIR(def);
        } catch (irErr: any) {
          log.error({ templateId: def.id, err: irErr.message }, 'IR compilation failed');
        }
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
// Subgraph loader
// ---------------------------------------------------------------------------

function loadSubgraphs(): SubgraphDefinition[] {
  const subgraphsDir = path.join(ASSETS_DIR, 'subgraphs');
  const subgraphs: SubgraphDefinition[] = [];

  if (!fs.existsSync(subgraphsDir)) {
    log.debug('No subgraphs directory found');
    return [];
  }

  try {
    const files = fs.readdirSync(subgraphsDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(subgraphsDir, file), 'utf-8');
      const def = JSON.parse(content) as SubgraphDefinition;
      if (def.kind === 'subgraph' && def.id && def.graphPipeline) {
        const gErrors = validateGraphPipeline(def.graphPipeline);
        if (gErrors.length > 0) {
          log.error({ subgraphId: def.id, errors: gErrors }, 'Subgraph validation failed, skipping');
          continue;
        }
        // Validate inputs/outputs reference existing nodes
        const nodeIds = new Set(def.graphPipeline.nodes.map(n => n.id));
        let portValid = true;
        for (const port of def.inputs ?? []) {
          if (!nodeIds.has(port.nodeId)) {
            log.error({ subgraphId: def.id, portId: port.id }, 'Input port references unknown node');
            portValid = false;
          }
        }
        for (const port of def.outputs ?? []) {
          if (!nodeIds.has(port.nodeId)) {
            log.error({ subgraphId: def.id, portId: port.id }, 'Output port references unknown node');
            portValid = false;
          }
        }
        if (!portValid) continue;
        subgraphs.push(def);
      }
    }
    log.info({ count: subgraphs.length }, 'Subgraphs loaded from disk');
  } catch (err: any) {
    log.error({ err: err.message }, 'Failed to load subgraphs');
  }

  return subgraphs;
}

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
   * Load all subgraph definitions from .agents/assets/subgraphs/
   */
  static loadAllSubgraphs(): SubgraphDefinition[] {
    if (!subgraphCache) {
      subgraphCache = loadSubgraphs();
      if (process.env.NODE_ENV !== 'production' && subgraphCache.length > 0) {
        globalForLoader.__AGENT_ASSET_LOADER_SUBGRAPHS = subgraphCache;
      }
    }
    return subgraphCache;
  }

  /**
   * Get a specific subgraph by ID
   */
  static getSubgraph(subgraphId: string): SubgraphDefinition | null {
    return AssetLoader.loadAllSubgraphs().find(s => s.id === subgraphId) ?? null;
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
    subgraphCache = null;
    clearIRCache();
  }
}
