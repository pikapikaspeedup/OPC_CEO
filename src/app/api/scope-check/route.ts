import { NextResponse } from "next/server";
import { checkWriteScopeConflicts, WriteScopeEntry } from "@/lib/agents/scope-governor";

export const dynamic = "force-dynamic";

// POST /api/scope-check — 检测 writeScope 冲突
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { packages } = body;
    // packages: { taskId: string, writeScope: WriteScopeEntry[] }[]

    if (!packages || !Array.isArray(packages)) {
      return NextResponse.json({ error: "Missing packages array" }, { status: 400 });
    }

    const conflicts = checkWriteScopeConflicts(packages);
    return NextResponse.json({
      hasConflicts: conflicts.length > 0,
      conflicts,
      checkedPackages: packages.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
