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

// ========== CPU 线程推测（后端统一计算，与导出报告同源） ==========

/**
 * cpu_consuming = 疑似 CPU 消耗（栈顶为 Java 方法）
 * io_wait       = I/O 等待（栈顶为 Native 阻塞点）
 * native        = 栈顶为 Native 方法但非已知阻塞点，无法认定为 CPU 消耗
 * gc            = GC / JVM 系统线程
 * no_stack      = 无调用栈，无法判断
 */
export type CpuInferenceCategory =
  | 'cpu_consuming'
  | 'io_wait'
  | 'native'
  | 'gc'
  | 'no_stack';

export interface CpuInferenceRow {
  category: CpuInferenceCategory;
  /** 线程详情（含完整调用栈） */
  thread: ThreadSummary;
  reasons: string[];
  stackDepth: number;
  topFrame: string;
}

export interface CpuInferenceVO {
  /** RUNNABLE 线程总数 */
  total: number;
  cpuCount: number;
  ioCount: number;
  gcCount: number;
  nativeCount: number;
  noStackCount: number;
  rows: CpuInferenceRow[];
}

// ========== 主响应体 ==========

export interface AnalysisResultVO {
  threadState: ThreadStateVO;
  lockGraph: LockGraphVO;
  flameGraph: FlameGraphVO;
  deadlockChain: DeadlockChainVO;
}

// ========== 报告分享 ==========

export interface ReportSummary {
  uuid: string;
  filename: string;
  expiresAt: number;
  totalThreads: number;
  hasDeadlock: boolean;
}

export interface StackGroupVO {
  stackKey: string;
  count: number;
  firstFrame: string;
  secondFrame: string;
  states: Record<string, number>;
  sampleThread: ThreadSummary;
  allThreadNames: string[];
}
