import pino from 'pino';
import { getCorrelationId } from './request-context';

const level = process.env.LOG_LEVEL || 'info';

function getLogContextBindings(): Record<string, string> {
  const bindings: Record<string, string> = {};
  const correlationId = getCorrelationId();
  if (correlationId) {
    bindings.correlationId = correlationId;
  }

  const processRole = process.env.AG_PROCESS_ROLE?.trim() || process.env.AG_ROLE?.trim();
  if (processRole) {
    bindings.processRole = processRole;
  }
  if (processRole === 'bridge-worker') {
    bindings.processTag = `[bridge-worker pid=${process.pid}]`;
  }

  return bindings;
}

function getTargets(filename: string): pino.TransportTargetOptions[] {
  return [
    {
      target: 'pino-roll',
      options: {
        file: `logs/${filename}`,
        frequency: 'daily',
        size: '10m',
        mkdir: true,
      },
      level,
    },
    {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
        // MCP stdio mode: stdout is reserved for JSON-RPC, redirect logs to stderr
        ...(process.env.ANTIGRAVITY_MCP ? { destination: 2 } : {}),
      },
      level: process.env.LOG_LEVEL || 'debug',
    },
  ];
}

const sysLogger = pino({ level: 'debug', mixin: getLogContextBindings }, pino.transport({ targets: getTargets('system') }));
const convLogger = pino({ level: 'debug', mixin: getLogContextBindings }, pino.transport({ targets: getTargets('conversation') }));
const wsLogger = pino({ level: 'debug', mixin: getLogContextBindings }, pino.transport({ targets: getTargets('workspace') }));

/**
 * Create a child logger with a module name.
 * Automatically routes to the correct file log based on module.
 */
export const createLogger = (module: string) => {
  let parent = sysLogger;
  
  if (['NewConv', 'SendMsg', 'Proceed', 'Revert', 'Steps', 'StepsAPI'].includes(module)) {
    parent = convLogger;
  } else if (['Launch', 'Close', 'Kill', 'FileSearch', 'Workspace'].includes(module)) {
    parent = wsLogger;
  }
  
  return parent.child({ module });
};
