import { z } from 'zod';

import type { Tool } from '../types';
import type { APITool } from './types';

/**
 * 将内部 Tool 定义转换为 API 工具模式（JSON Schema 格式）
 */
export function toolToAPISchema(tool: Tool): APITool {
  return {
    name: tool.name,
    description: resolveToolDescription(tool),
    input_schema: tool.inputJSONSchema ?? zodToJsonSchema(tool.inputSchema),
  };
}

/**
 * 批量转换
 */
export function toolsToAPISchemas(tools: Tool[]): APITool[] {
  return tools.map(toolToAPISchema);
}

function resolveToolDescription(tool: Tool): string {
  try {
    const description = tool.description({} as Record<string, unknown>);

    if (typeof description === 'string' && description.trim() && !description.includes('undefined')) {
      return description;
    }
  } catch {
    // fall through to the generic fallback below
  }

  return tool.name;
}

function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodDefault) {
    return zodToJsonSchema(unwrapSchema(schema as z.ZodDefault<z.ZodTypeAny>));
  }

  if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema(schema.unwrap() as z.ZodTypeAny);
  }

  if (schema instanceof z.ZodNullable) {
    return {
      anyOf: [zodToJsonSchema(schema.unwrap() as z.ZodTypeAny), { type: 'null' }],
    };
  }

  if (schema instanceof z.ZodString) {
    return { type: 'string' };
  }

  if (schema instanceof z.ZodNumber) {
    return { type: 'number' };
  }

  if (schema instanceof z.ZodBoolean) {
    return { type: 'boolean' };
  }

  if (schema instanceof z.ZodArray) {
    return {
      type: 'array',
      items: zodToJsonSchema(schema.element as z.ZodTypeAny),
    };
  }

  if (schema instanceof z.ZodEnum) {
    return {
      type: 'string',
      enum: [...schema.options],
    };
  }

  if (schema instanceof z.ZodLiteral) {
    return {
      const: schema.value,
      type: literalType(schema.value),
    };
  }

  if (schema instanceof z.ZodRecord) {
    return {
      type: 'object',
      additionalProperties: zodToJsonSchema(schema.valueType as z.ZodTypeAny),
    };
  }

  if (schema instanceof z.ZodUnion) {
    return {
      anyOf: (schema.options as z.ZodTypeAny[]).map(zodToJsonSchema),
    };
  }

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties = Object.fromEntries(
      Object.entries(shape).map(([key, value]) => [key, zodToJsonSchema(value as z.ZodTypeAny)]),
    );
    const required = Object.entries(shape)
      .filter(([, value]) => !isOptionalInput(value))
      .map(([key]) => key);

    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    };
  }

  if (schema instanceof z.ZodUnknown || schema instanceof z.ZodAny) {
    return {};
  }

  return {};
}

function isOptionalInput(schema: z.ZodTypeAny): boolean {
  return schema instanceof z.ZodOptional || schema instanceof z.ZodDefault;
}

function unwrapSchema(schema: z.ZodDefault<z.ZodTypeAny>): z.ZodTypeAny {
  const candidate = schema.removeDefault?.();

  if (candidate) {
    return candidate;
  }

  const innerType = (schema as unknown as { _def?: { innerType?: z.ZodTypeAny } })._def?.innerType;

  return innerType ?? schema;
}

function literalType(value: unknown): string | undefined {
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return typeof value;
    default:
      return undefined;
  }
}