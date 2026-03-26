import { NextResponse } from 'next/server';
import { listPipelines } from '@/lib/agents/pipeline-registry';

export async function GET() {
  try {
    const templates = listPipelines();
    return NextResponse.json(templates);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
