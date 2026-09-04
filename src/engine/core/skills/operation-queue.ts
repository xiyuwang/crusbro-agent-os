/**
 * 操作队列模块
 *
 * 设计原则 (UNIX哲学):
 * - 简洁: 只负责队列管理，单一职责
 * - 模块化: 独立的队列逻辑，易于测试和维护
 * - 隔离: 与技能管理逻辑分离，专注于并发控制
 */

import { logger } from '../../utils/logger';

/**
 * 操作类型枚举
 */
export enum OperationType {
  CREATE = 'create',
  RENAME = 'rename',
  EDIT = 'edit',
  DELETE = 'delete',
  RESTORE = 'restore',
}

/**
 * 操作状态枚举
 */
export enum OperationStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * 操作任务接口
 */
export interface OperationTask {
  /** 操作ID */
  id: string;
  /** 操作类型 */
  type: OperationType;
  /** 目标技能 */
  targetSkill: string;
  /** 操作状态 */
  status: OperationStatus;
  /** 执行操作 */
  execute(): Promise<void>;
  /** 创建时间 */
  createdAt: Date;
  /** 开始时间 */
  startedAt?: Date;
  /** 完成时间 */
  completedAt?: Date;
  /** 错误信息 */
  error?: Error;
}

/**
 * 操作队列类
 *
 * 职责:
 * - 管理技能管理操作的并发执行
 * - 按FIFO顺序处理操作
 * - 防止操作冲突
 */
export class OperationQueue {
  private queue: OperationTask[] = [];
  private processing: boolean = false;
  private readonly maxConcurrent: number = 1; // 串行执行，避免冲突

  /**
   * 入队操作
   */
  async enqueue(task: OperationTask): Promise<void> {
    this.queue.push(task);
    logger.log(`[OperationQueue] 操作已入队: ${task.type} - ${task.targetSkill}`);

    // 如果没有正在处理，启动处理（不等待，异步执行）
    if (!this.processing) {
      // 不使用await，让队列异步处理
      this.processQueue().catch(error => {
        logger.error('[OperationQueue] Queue processing error:', error);
      });
    }
  }

  /**
   * 出队操作
   */
  private dequeue(): OperationTask | null {
    return this.queue.shift() || null;
  }

  /**
   * 处理队列
   */
  private async processQueue(): Promise<void> {
    this.processing = true;

    while (this.queue.length > 0) {
      const task = this.dequeue();
      if (!task) break;

      task.status = OperationStatus.PROCESSING;
      task.startedAt = new Date();

      try {
        logger.log(`[OperationQueue] 开始处理: ${task.type} - ${task.targetSkill}`);
        await task.execute();

        task.status = OperationStatus.COMPLETED;
        task.completedAt = new Date();
        logger.log(`[OperationQueue] 操作完成: ${task.type} - ${task.targetSkill}`);
      } catch (error: any) {
        task.status = OperationStatus.FAILED;
        task.completedAt = new Date();
        task.error = error;
        logger.error(`[OperationQueue] 操作失败: ${task.type} - ${task.targetSkill}`, error);
      }
    }

    this.processing = false;
  }

  /**
   * 获取队列状态
   */
  getQueueStatus(): {
    length: number;
    processing: boolean;
    tasks: OperationTask[];
  } {
    return {
      length: this.queue.length,
      processing: this.processing,
      tasks: [...this.queue],
    };
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.queue = [];
    logger.log('[OperationQueue] 队列已清空');
  }
}
