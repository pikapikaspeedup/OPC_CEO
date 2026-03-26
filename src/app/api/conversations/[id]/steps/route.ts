import { NextResponse } from 'next/server';
import { getAllConnections, grpc } from '@/lib/bridge/gateway';
import { createLogger } from '@/lib/logger';

const log = createLogger('StepsAPI');

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: cascadeId } = await params;
  try {
    const conns = getAllConnections();
    log.info({ cascadeId: cascadeId.slice(0,8), serverCount: conns.length }, 'Steps request');
    let checkpointData: any = null;
    for (const conn of conns) {
      try {
        await grpc.loadTrajectory(conn.port, conn.csrf, cascadeId);
        const data = await grpc.getTrajectorySteps(conn.port, conn.csrf, conn.apiKey, cascadeId);
        if (data?.steps?.length) {
          log.info({ cascadeId: cascadeId.slice(0,8), port: conn.port, steps: data.steps.length }, 'Steps found');
          checkpointData = data;
          break;
        } else {
          log.warn({ cascadeId: cascadeId.slice(0,8), port: conn.port, dataKeys: data ? Object.keys(data) : 'null' }, 'No steps from server');
        }
      } catch (innerErr: any) {
        log.warn({ cascadeId: cascadeId.slice(0,8), port: conn.port, err: innerErr.message }, 'Server attempt failed');
      }
    }

    if (!checkpointData) {
      log.error({ cascadeId: cascadeId.slice(0,8), serversChecked: conns.length, ports: conns.map(c => c.port) }, 'Conversation not found on any server');
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    return NextResponse.json(checkpointData);
  } catch (e: any) {
    log.error({ cascadeId: cascadeId.slice(0,8), err: e.message }, 'Steps request error');
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
