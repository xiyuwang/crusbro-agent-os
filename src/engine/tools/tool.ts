import { z, ZodType } from 'zod';
import { globalToolRegistry, ToolInstance, ToolDescriptor } from './registry';
import { ToolContext } from '../core/types';
import { Hooks } from '../core/hooks';

/**
 * 工具定义接口
 */
export interface ToolDefinition<TArgs = any, TResult = any> {
  name: string;
  description?: string;
  parameters?: ZodType<TArgs>;
  execute: (args: TArgs, ctx: EnhancedToolContext) => Promise<TResult> | TResult;
  metadata?: {
    version?: string;
    tags?: string[];
    cacheable?: boolean;
    cacheTTL?: number;
    timeout?: number;
    concurrent?: boolean;
    readonly?: boolean;
  };
  hooks?: Hooks;
}

/**
 * 工具上下文增强接口
 */
export interface EnhancedToolContext extends ToolContext {
  emit(eventType: string, data?: any): void;
}

/**
 * 重载 1: tool(name, executeFn)
 * 零配置模式，自动推断类型
 */
export function tool<TArgs = any, TResult = any>(
  name: string,
  executeFn: (args: TArgs, ctx?: EnhancedToolContext) => Promise<TResult> | TResult
): ToolInstance;

/**
 * 重载 2: tool(definition)
 * 完整配置模式
 */
export function tool<TArgs = any, TResult = any>(
  definition: ToolDefinition<TArgs, TResult>
): ToolInstance;

/**
 * 实现
 */
export function tool<TArgs = any, TResult = any>(
  nameOrDef: string | ToolDefinition<TArgs, TResult>,
  executeFn?: (args: TArgs, ctx?: EnhancedToolContext) => Promise<TResult> | TResult
): ToolInstance {
  // 解析参数
  const def: ToolDefinition<TArgs, TResult> =
    typeof nameOrDef === 'string'
      ? {
          name: nameOrDef,
          description: `Execute ${nameOrDef}`,
          parameters: z.any() as ZodType<TArgs>,
          execute: executeFn!,
        }
      : nameOrDef;

  // 生成 JSON Schema (使用 Zod v4 原生方法)
  let input_schema: any;
  if (def.parameters) {
    // Zod v4: 使用 zodToJsonSchema 的替代方案
    // 由于 zod-to-json-schema 已被弃用，我们需要手动转换 Zod schema 为 JSON Schema
    input_schema = zodToJsonSchemaManual(def.parameters as any);
  } else {
    input_schema = { type: 'object', properties: {} };
  }

  // 创建工具实例
  const toolInstance: ToolInstance = {
    name: def.name,
    description: def.description || `Execute ${def.name}`,
    input_schema,
    hooks: def.hooks,

    async exec(args: any, ctx: ToolContext): Promise<any> {
      try {
        // 参数验证
        if (def.parameters) {
          const parseResult = def.parameters.safeParse(args);
          if (!parseResult.success) {
            return {
              ok: false,
              error: `Invalid parameters: ${parseResult.error.message}`,
              _validationError: true,
            };
          }
          args = parseResult.data;
        }

        // 增强上下文
        const enhancedCtx: EnhancedToolContext = {
          ...ctx,
          emit(eventType: string, data?: any) {
            ctx.agent?.events?.emitMonitor({
              type: 'tool_custom_event' as any,
              toolName: def.name,
              eventType,
              data,
              timestamp: Date.now(),
            } as any);
          },
        };

        // 执行工具
        const result = await def.execute(args, enhancedCtx);

        // 如果工具返回 {ok: false}，保持原样
        if (result && typeof result === 'object' && 'ok' in result && (result as any).ok === false) {
          return result;
        }

        // 正常结果
        return result;
      } catch (error: any) {
        // 捕获工具执行中的所有错误，统一返回格式
        return {
          ok: false,
          error: error?.message || String(error),
          _thrownError: true,
        };
      }
    },

    toDescriptor(): ToolDescriptor {
      return {
        source: 'registered',
        name: def.name,
        registryId: def.name,
        metadata: {
          version: def.metadata?.version,
          tags: def.metadata?.tags,
          cacheable: def.metadata?.cacheable,
          cacheTTL: def.metadata?.cacheTTL,
          timeout: def.metadata?.timeout,
          concurrent: def.metadata?.concurrent,
          access: def.metadata?.readonly ? 'read' : 'write',
          mutates: !def.metadata?.readonly,
        },
      };
    },
  };

  // 自动注册到全局 registry
  globalToolRegistry.register(def.name, () => toolInstance);

  return toolInstance;
}

/**
 * 批量定义工具
 */
export function tools(definitions: ToolDefinition[]): ToolInstance[] {
  return definitions.map((def) => tool(def));
}

/**
 * 手动转换 Zod Schema 为 JSON Schema (替代已弃用的 zod-to-json-schema)
 *
 * 设计原则：
 * - 简洁：只处理工具定义中常用的 Zod 类型
 * - 健壮：对于不支持的类型，返回默认的 object schema
 * - 可扩展：可以根据需要添加更多类型的支持
 */
function zodToJsonSchemaManual(zodType: z.ZodTypeAny): any {
  // 处理 ZodEffects 类型（经过 .transform()、.refine() 等转换的 schema）
  const typeName = (zodType as any)._def?.typeName;
  if (typeName === 'ZodEffects' || (typeof typeName === 'string' && typeName.includes('ZodEffects'))) {
    const innerSchema = (zodType as any)._def.schema;
    if (innerSchema) {
      return zodToJsonSchemaManual(innerSchema);
    }
    return { type: 'object', properties: {}, required: [] };
  }

  // 如果是 ZodObject
  if (zodType instanceof z.ZodObject) {
    // Zod v4: shape 是属性而非方法
    const shape = (zodType as any).shape || (zodType as any)._def.shape;
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const fieldSchema = convertZodType(value as z.ZodTypeAny);
      properties[key] = fieldSchema;

      // 检查是否可选
      const isOptional = isZodTypeOptional(value as z.ZodTypeAny);
      if (!isOptional) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required,
    };
  }

  // 默认返回空对象
  return {
    type: 'object',
    properties: {},
    required: [],
  };
}

/**
 * 转换 Zod 类型为 JSON Schema 类型
 */
function convertZodType(zodType: z.ZodTypeAny): any {
  // 处理可选类型
  if (zodType instanceof z.ZodOptional) {
    const innerType = (zodType as any)._def.innerType;
    return convertZodType(innerType);
  }

  // 处理默认值类型
  if (zodType instanceof z.ZodDefault) {
    const innerType = (zodType as any)._def.innerType;
    return convertZodType(innerType);
  }

  // 基本类型映射
  if (zodType instanceof z.ZodString) {
    return { type: 'string' };
  }

  if (zodType instanceof z.ZodNumber) {
    return { type: 'number' };
  }

  if (zodType instanceof z.ZodBoolean) {
    return { type: 'boolean' };
  }

  if (zodType instanceof z.ZodArray) {
    const elementType = (zodType as any)._def.type;
    return {
      type: 'array',
      items: convertZodType(elementType),
    };
  }

  if (zodType instanceof z.ZodObject) {
    return zodToJsonSchemaManual(zodType);
  }

  if (zodType instanceof z.ZodEnum) {
    return {
      type: 'string',
      enum: (zodType as any)._def.values,
    };
  }

  if (zodType instanceof z.ZodLiteral) {
    return {
      type: typeof (zodType as any)._def.value,
      const: (zodType as any)._def.value,
    };
  }

  // 未知类型，默认为 object（避免意外返回 string）
  return { type: 'object', properties: {}, required: [] };
}

/**
 * 检查 Zod 类型是否可选
 */
function isZodTypeOptional(zodType: z.ZodTypeAny): boolean {
  return (
    zodType instanceof z.ZodOptional ||
    zodType instanceof z.ZodDefault ||
    (zodType as any).isNullable?.() === true
  );
}
