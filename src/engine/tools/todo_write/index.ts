import { tool } from '../tool';
import { z } from 'zod';
import { DESCRIPTION, PROMPT } from './prompt';
import { TodoItem, TodoInput } from '../../core/todo';

/**
 * Be permissive: real-world manager prompts often send {content,status} without ids.
 * Also accept "cancelled" (runtime-side conventions) to avoid schema-blocking.
 */
const todoItemSchema = z
  .object({
    id: z.string().optional().describe('Unique identifier for the todo (optional)'),
    title: z.string().optional().describe('Clear description of the task (optional)'),
    content: z.string().optional().describe('Legacy alias of title'),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).describe('Current status'),
    assignee: z.string().optional().describe('Who is responsible'),
    notes: z.string().optional().describe('Additional context'),
  })
  .passthrough();

export const TodoWrite = tool({
  name: 'todo_write',
  description: DESCRIPTION,
  parameters: z.object({
    todos: z.array(todoItemSchema).describe('Array of todo items'),
  }),
  async execute(args, ctx) {
    const raw = Array.isArray((args as any)?.todos) ? ((args as any).todos as any[]) : [];
    const normalized: TodoInput[] = raw.map((t, i) => {
      const title = String(t?.title ?? t?.content ?? '').trim() || `todo_${i + 1}`;
      const id = String(t?.id ?? '').trim() || `todo_${i + 1}`;
      const st = String(t?.status ?? 'pending').trim();
      const status =
        st === 'in_progress' || st === 'completed' || st === 'cancelled' ? (st as any) : 'pending';
      const out: any = { id, title, status };
      if (typeof t?.assignee === 'string' && t.assignee.trim()) out.assignee = String(t.assignee).trim();
      if (typeof t?.notes === 'string' && t.notes.trim()) out.notes = String(t.notes).trim();
      return out as TodoInput;
    });

    // Avoid hard-failing: if multiple in_progress are provided, keep the first and downgrade the rest to pending.
    let seenInProgress = false;
    for (const t of normalized) {
      if (t.status === 'in_progress') {
        if (!seenInProgress) {
          seenInProgress = true;
        } else {
          (t as any).status = 'pending';
        }
      }
    }

    if (!ctx.agent?.setTodos) {
      const service = ctx.services?.todo;
      if (!service) {
        throw new Error('Todo service not enabled for this agent');
      }
      await service.setTodos(normalized as unknown as TodoItem[]);
      return { ok: true, count: normalized.length };
    }

    await ctx.agent.setTodos(normalized as TodoInput[]);
    return { ok: true, count: normalized.length };
  },
  metadata: {
    readonly: false,
    version: '1.0',
  },
});

TodoWrite.prompt = PROMPT;
