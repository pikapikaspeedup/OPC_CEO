import { NextResponse } from 'next/server';
import path from 'path';
import { homedir } from 'os';
import { readFileSync } from 'fs';

export const dynamic = 'force-dynamic';

export async function GET() {
  const mcpPath = path.join(homedir(), '.gemini/antigravity/mcp_config.json');
  try {
    const content = readFileSync(mcpPath, 'utf-8');
    if (!content.trim()) return NextResponse.json({ servers: [], tools: [] });
    const config = JSON.parse(content) as { servers?: Array<Record<string, unknown>> };
    const servers = config.servers ?? [];
    return NextResponse.json({
      servers: servers.map((s) => ({
        name: s.name,
        type: s.type ?? 'stdio',
        description: s.description,
        command: s.command,
        url: s.url,
      })),
      tools: [],
    });
  } catch {
    return NextResponse.json({ servers: [], tools: [] });
  }
}
