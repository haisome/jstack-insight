/**
 * TypeScript 类型定义 — 严格对应后端 VO 结构
 * 禁止使用 any，所有字段均有明确类型
 */

// ========== 通用响应 ==========

export interface ApiResult<T> {
  code: number;
  msg: string;
  data: T;
}

// ========== 线程状态 ==========

export interface ThreadSummary {
  name: string;
  tid?: number;
  nid?: string;
  state: string;
  inDeadlock: boolean;
  finalizerTrapped: boolean;
  throwingException: boolean;
  waitingOnLock?: string;
  waitingType?: string;
  waitingOnLockClass?: string;
  lockedMonitors: string[];
  lockedMonitorClasses?: string[];
  stackTrace: string[];
  cpuPercent?: number;
}

export interface ThreadStateVO {
  totalThreads: number;
  stateCounts: Record<string, number>;
  deadlockCount: number;
  threads: ThreadSummary[];
}

// ========== 锁竞争图 ==========

export interface GraphNode {
  id: string;
  label: string;
  /** THREAD | LOCK */
  type: 'THREAD' | 'LOCK';
  state?: string;
  inDeadlock: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  /** HOLDS | WAITING */
  relation: 'HOLDS' | 'WAITING';
  inDeadlock: boolean;
}

export interface LockGraphVO {
  nodes: GraphNode[];
  edges: GraphEdge[];
  hasDeadlock: boolean;
  deadlockChains: string[];
}

// ========== 火焰图 ==========

export interface FlameNode {
  name: string;
  value: number;
  /** jdk | spring | app | other */
  colorCategory: 'jdk' | 'spring' | 'app' | 'other';
  fullSignature: string;
  children?: FlameNode[];
}

export interface FlameGraphVO {
  root: FlameNode;
}

// ========== 死锁链路 ==========

export interface DeadlockChainVO {
  detected: boolean;
  chains: string[][];
  descriptions: string[];
}

// ========== 精准 CPU 分析（top + jstack 关联） ==========

export interface TopCpuThreadInfo {
  name: string;
  pid: number;
  nid: string;
  cpuPercent: number;
  state: string;
  topFrame: string;
  inDeadlock: boolean;
}

export interface TopCpuVO {
  totalThreads: number;
  totalCpuPercent: number;
  matchedCount: number;
  unmatchedCount: number;
  threads: TopCpuThreadInfo[];
}

// ========== 主响应体 ==========

export interface AnalysisResultVO {
  threadState: ThreadStateVO;
  lockGraph: LockGraphVO;
  flameGraph: FlameGraphVO;
  deadlockChain: DeadlockChainVO;
}
