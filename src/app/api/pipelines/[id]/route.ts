import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { AssetLoader } from '@/lib/agents/asset-loader';
import { appendAuditEvent } from '@/lib/agents/ops-audit';
import { GLOBAL_ASSETS_DIR } from '@/lib/agents/gateway-home';
import { validateGraphPipeline } from '@/lib/agents/graph-compiler';
import { validateTemplatePipeline } from '@/lib/agents/pipeline-graph';
import type { TemplateDefinition } from '@/lib/agents/pipeline-types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/pipelines/[id]
 * Get full template definition by ID.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const template = AssetLoader.getTemplate(id);

  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  // Resolve workflow content for each role so FE can display rules
  const groupsWithWorkflows = Object.fromEntries(
    Object.entries(template.groups).map(([gid, g]) => [
      gid,
      {
        ...g,
        roles: g.roles.map(r => ({
          ...r,
          workflowContent: AssetLoader.resolveWorkflowContent(r.workflow),
        })),
      },
    ]),
  );

  return NextResponse.json({
    ...template,
    groups: groupsWithWorkflows,
  });
}

/**
 * PUT /api/pipelines/[id]
 * Update a template definition (save to disk).
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const existing = AssetLoader.getTemplate(id);

  if (!existing) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Build the updated template, preserving id/kind
  const updated: TemplateDefinition = {
    ...existing,
    ...body,
    id, // cannot change id
    kind: 'template', // cannot change kind
  };

  // Validate
  const errors: string[] = [];
  if (updated.graphPipeline) {
    const gErrors = validateGraphPipeline(updated.graphPipeline);
    errors.push(...gErrors);
  } else if (updated.pipeline?.length) {
    const pErrors = validateTemplatePipeline(updated);
    errors.push(...pErrors);
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: 'Validation failed', errors }, { status: 422 });
  }

  // Save to disk
  const templatesDir = path.join(GLOBAL_ASSETS_DIR, 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });
  const filePath = path.join(templatesDir, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8');

  // Also sync to repo .agents if it exists
  const repoTemplatesDir = path.join(process.cwd(), '.agents', 'assets', 'templates');
  if (fs.existsSync(repoTemplatesDir)) {
    const repoPath = path.join(repoTemplatesDir, `${id}.json`);
    fs.writeFileSync(repoPath, JSON.stringify(updated, null, 2), 'utf-8');
  }

  // Reload cache
  AssetLoader.reloadTemplates();

  appendAuditEvent({
    kind: 'template:updated',
    message: `Template updated: ${id}`,
    meta: { templateId: id },
  });

  return NextResponse.json({ success: true, templateId: id });
}

/**
 * DELETE /api/pipelines/[id]
 * Delete a template from disk.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const existing = AssetLoader.getTemplate(id);

  if (!existing) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  // Delete from global assets
  const globalPath = path.join(GLOBAL_ASSETS_DIR, 'templates', `${id}.json`);
  if (fs.existsSync(globalPath)) {
    fs.unlinkSync(globalPath);
  }

  // Delete from repo .agents if it exists
  const repoPath = path.join(process.cwd(), '.agents', 'assets', 'templates', `${id}.json`);
  if (fs.existsSync(repoPath)) {
    fs.unlinkSync(repoPath);
  }

  AssetLoader.reloadTemplates();

  appendAuditEvent({
    kind: 'template:deleted',
    message: `Template deleted: ${id}`,
    meta: { templateId: id },
  });

  return NextResponse.json({ success: true, templateId: id });
}

/**
 * POST /api/pipelines/[id]
 * Clone a template with a new ID.
 * Body: { newId: string; newTitle?: string }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const existing = AssetLoader.getTemplate(id);

  if (!existing) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || !body.newId || typeof body.newId !== 'string') {
    return NextResponse.json({ error: 'newId is required' }, { status: 400 });
  }

  const { newId, newTitle } = body as { newId: string; newTitle?: string };

  // Validate newId format
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(newId) || newId.length > 80) {
    return NextResponse.json({ error: 'Invalid newId format (lowercase alphanumeric with hyphens, 2-80 chars)' }, { status: 400 });
  }

  // Check no conflict
  if (AssetLoader.getTemplate(newId)) {
    return NextResponse.json({ error: `Template '${newId}' already exists` }, { status: 409 });
  }

  const cloned: TemplateDefinition = {
    ...structuredClone(existing),
    id: newId,
    title: newTitle || `${existing.title} (Copy)`,
  };

  // Save to disk
  const templatesDir = path.join(GLOBAL_ASSETS_DIR, 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });
  const filePath = path.join(templatesDir, `${newId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(cloned, null, 2), 'utf-8');

  // Also sync to repo .agents if it exists
  const repoTemplatesDir = path.join(process.cwd(), '.agents', 'assets', 'templates');
  if (fs.existsSync(repoTemplatesDir)) {
    const repoPath = path.join(repoTemplatesDir, `${newId}.json`);
    fs.writeFileSync(repoPath, JSON.stringify(cloned, null, 2), 'utf-8');
  }

  AssetLoader.reloadTemplates();

  appendAuditEvent({
    kind: 'template:cloned',
    message: `Template cloned: ${id} → ${newId}`,
    meta: { sourceId: id, newId },
  });

  return NextResponse.json({ success: true, templateId: newId }, { status: 201 });
}
