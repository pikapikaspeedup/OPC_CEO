import fs from 'fs';
import path from 'path';
import { normalizeTemplateDefinition } from '../src/lib/agents/pipeline/template-normalizer';

type JsonRecord = Record<string, unknown>;

function parseArgs(argv: string[]) {
  const args = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--check') {
      args.set('check', true);
      continue;
    }
    if (token === '--dir') {
      args.set('dir', argv[i + 1] ?? '');
      i += 1;
    }
  }
  return {
    check: args.get('check') === true,
    dir: typeof args.get('dir') === 'string' && args.get('dir')
      ? String(args.get('dir'))
      : path.join(process.cwd(), '.agents', 'assets', 'templates'),
  };
}

function readJson(filePath: string): JsonRecord {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as JsonRecord;
}

function maybeSynthesizeEntryStage(template: JsonRecord): JsonRecord {
  const pipeline = Array.isArray(template.pipeline) ? template.pipeline : [];
  const graphPipeline = template.graphPipeline;
  const groups = template.groups;

  if (pipeline.length > 0 || graphPipeline || !groups || typeof groups !== 'object') {
    return template;
  }

  const groupEntries = Object.entries(groups as JsonRecord);
  if (groupEntries.length !== 1) {
    throw new Error(
      `Template '${String(template.id)}' has groups without pipeline/graphPipeline and cannot infer a single entry stage`,
    );
  }

  const [stageId] = groupEntries[0];
  return {
    ...template,
    pipeline: [
      {
        stageId,
        groupId: stageId,
        autoTrigger: false,
      },
    ],
  };
}

function stripDeprecatedFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripDeprecatedFields);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const output: JsonRecord = {};
  for (const [key, raw] of Object.entries(value as JsonRecord)) {
    if (key === 'groups' || key === 'groupId' || key === 'legacyGroupId' || key === 'acceptedSourceGroupIds') {
      continue;
    }

    const cleaned = stripDeprecatedFields(raw);
    if (cleaned === undefined) continue;
    if (Array.isArray(cleaned) && cleaned.length === 0 && key !== 'roles' && key !== 'pipeline' && key !== 'nodes' && key !== 'edges') {
      continue;
    }
    if (
      cleaned &&
      typeof cleaned === 'object' &&
      !Array.isArray(cleaned) &&
      Object.keys(cleaned as JsonRecord).length === 0
    ) {
      continue;
    }

    output[key] = cleaned;
  }

  return output;
}

function migrateTemplate(filePath: string, checkOnly: boolean): 'unchanged' | 'updated' {
  const original = readJson(filePath);
  const normalized = normalizeTemplateDefinition(maybeSynthesizeEntryStage(original) as any);
  const canonical = stripDeprecatedFields(normalized);
  const nextContent = `${JSON.stringify(canonical, null, 2)}\n`;
  const prevContent = fs.readFileSync(filePath, 'utf8');

  if (prevContent === nextContent) {
    return 'unchanged';
  }

  if (!checkOnly) {
    fs.writeFileSync(filePath, nextContent, 'utf8');
  }
  return 'updated';
}

function main() {
  const { check, dir } = parseArgs(process.argv.slice(2));
  const files = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => path.join(dir, name));

  if (files.length === 0) {
    console.log(`No template JSON files found in ${dir}`);
    return;
  }

  const updated: string[] = [];
  const unchanged: string[] = [];

  for (const filePath of files) {
    const status = migrateTemplate(filePath, check);
    if (status === 'updated') updated.push(path.basename(filePath));
    else unchanged.push(path.basename(filePath));
  }

  console.log(
    JSON.stringify(
      {
        mode: check ? 'check' : 'write',
        dir,
        updated,
        unchanged,
      },
      null,
      2,
    ),
  );

  if (check && updated.length > 0) {
    process.exitCode = 1;
  }
}

main();
