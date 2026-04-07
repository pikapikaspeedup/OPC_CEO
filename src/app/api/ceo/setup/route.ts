import { NextResponse } from 'next/server';
import { getCEOWorkspacePath } from '@/lib/agents/ceo-environment';
import * as fs from 'fs/promises';
import * as path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const wsPath = getCEOWorkspacePath();
    const identityPath = path.join(wsPath, '.agents/rules/department-identity.md');
    const playbookPath = path.join(wsPath, '.agents/workflows/ceo-playbook.md');

    const identity = await fs.readFile(identityPath, 'utf8').catch(() => '');
    const playbook = await fs.readFile(playbookPath, 'utf8').catch(() => '');

    return NextResponse.json({ identity, playbook });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { identity, playbook } = await req.json();
    const wsPath = getCEOWorkspacePath();
    
    if (typeof identity === 'string') {
      const identityPath = path.join(wsPath, '.agents/rules/department-identity.md');
      await fs.writeFile(identityPath, identity, 'utf8');
    }
    
    if (typeof playbook === 'string') {
      const playbookPath = path.join(wsPath, '.agents/workflows/ceo-playbook.md');
      await fs.writeFile(playbookPath, playbook, 'utf8');
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
