import React, { useMemo } from 'react';
import {
  Card, Typography, Alert, Tag, Collapse, Divider, Empty, Space, Row, Col, Statistic, Tooltip, Popover,
} from 'antd';
import {
  BugOutlined, LockOutlined, SyncOutlined, RightOutlined, WarningOutlined,
  CheckCircleOutlined, QuestionCircleOutlined,
} from '@ant-design/icons';
import type { DeadlockChainVO, ThreadStateVO, LockGraphVO, ThreadSummary } from '../../types';

const { Title, Text, Paragraph } = Typography;
const { Panel } = Collapse;

// ================================================================
// 类型定义
// ================================================================

interface DeadlockDetailProps {
  deadlockChain: DeadlockChainVO;
  threadState: ThreadStateVO;
  lockGraph: LockGraphVO;
}

/** 死锁类型分类 */
type DeadlockType = 'MONITOR' | 'JUC_LOCK' | 'MIXED';

/** 单条死锁链路的分析结果 */
interface ChainAnalysis {
  chainIndex: number;
  chain: string[];
  /** 不重复的线程名（去掉首尾重复） */
  uniqueThreads: string[];
  /** 不重复的线程详情 */
  threadDetails: ThreadSummary[];
  /** 死锁类型 */
  deadlockType: DeadlockType;
  /** 类型标签 */
  typeLabel: string;
  /** 类型描述 */
  typeDescription: string;
}

// ================================================================
// 常量
// ================================================================

const STATE_COLOR_MAP: Record<string, string> = {
  RUNNABLE: '#1890ff',
  BLOCKED: '#ff4d4f',
  WAITING: '#faad14',
  TIMED_WAITING: '#13c2c2',
  TERMINATED: '#8c8c8c',
  NEW: '#52c41a',
  UNKNOWN: '#bfbfbf',
};

const STATE_LABEL_MAP: Record<string, string> = {
  RUNNABLE: '运行中',
  BLOCKED: '阻塞',
  WAITING: '等待',
  TIMED_WAITING: '限时等待',
  TERMINATED: '已终止',
  NEW: '新建',
  UNKNOWN: '未知',
};

const CHAIN_COLORS = ['#1677ff', '#722ed1', '#13c2c2', '#eb2f96', '#fa8c16'];

// ================================================================
// 帮助提示 Popover 内容
// ================================================================

const SUMMARY_HELP = (
  <div style={{ maxWidth: 520, fontSize: 13 }}>
    <p style={{ margin: '0 0 8px', fontWeight: 600 }}>死锁摘要指标说明</p>
    <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
      <li><strong>死锁链路数</strong>：检测到的独立死锁环数量。每组死锁是线程间循环等待形成的闭环。</li>
      <li><strong>涉及线程数</strong>：参与死锁的所有不重复线程总数。</li>
      <li><strong>Monitor 锁</strong>：由 <code>synchronized</code> 关键字引发的死锁，线程处于 <Tag color="red" style={{ fontSize: 10 }}>BLOCKED</Tag> 状态。</li>
      <li><strong>JUC Lock</strong>：由 <code>ReentrantLock</code> 等 JUC 锁引发的死锁，线程处于 <Tag color="orange" style={{ fontSize: 10 }}>WAITING</Tag> (parking) 状态。</li>
    </ul>
  </div>
);

const FLOW_DIAGRAM_HELP = (
  <div style={{ maxWidth: 480, fontSize: 13 }}>
    <p style={{ margin: '0 0 8px', fontWeight: 600 }}>死锁链路图说明</p>
    <p style={{ margin: '0 0 6px', color: '#666' }}>
      链路图以从左到右的流向展示线程间的等待关系：
    </p>
    <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
      <li>每个<strong>色块</strong>代表一个参与死锁的线程</li>
      <li><strong>实线箭头 →</strong> 表示"A 等待 B 持有的锁"</li>
      <li><strong>红色虚线弧 ⟲</strong> 闭合环路：最后一个线程等待第一个线程，形成死锁</li>
      <li><strong>点击</strong>任意线程节点可快速定位到下方详情</li>
    </ul>
  </div>
);

const THREAD_DETAIL_HELP = (
  <div style={{ maxWidth: 500, fontSize: 13 }}>
    <p style={{ margin: '0 0 8px', fontWeight: 600 }}>线程详情解读</p>
    <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
      <li><strong>当前等待 (WAITING FOR)</strong>：该线程正在等待获取的锁地址，以及该锁当前被哪个线程持有。</li>
      <li><strong>当前持有 (LOCKED)</strong>：该线程已获取并持有的锁地址列表。</li>
      <li><strong>堆栈跟踪</strong>：线程当前的完整调用栈。
        <ul style={{ margin: '2px 0 0', paddingLeft: 18, lineHeight: 1.8 }}>
          <li><span style={{ color: '#f48771' }}>红色行</span>：锁等待/持有的关键行</li>
          <li><span style={{ color: '#6a9955' }}>绿色行</span>：持有锁的位置</li>
          <li>栈顶（第一帧）通常是死锁触发的直接位置</li>
        </ul>
      </li>
    </ul>
  </div>
);

const SOLUTION_HELP = (
  <div style={{ maxWidth: 520, fontSize: 13 }}>
    <p style={{ margin: '0 0 8px', fontWeight: 600 }}>死锁解决策略</p>
    <p style={{ margin: '0 0 6px', color: '#666' }}>
      死锁的四个必要条件（互斥、持有并等待、不可抢占、循环等待），打破任一条件即可解决。
      以下建议按优先级排列：
    </p>
    <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
      <li><strong>打破循环等待</strong>：统一加锁顺序是最简单有效的方案。</li>
      <li><strong>打破持有并等待</strong>：使用 tryLock(timeout) 超时机制。</li>
      <li><strong>减小互斥范围</strong>：缩小同步块、降低锁粒度。</li>
      <li><strong>消除互斥</strong>：使用无锁数据结构（ConcurrentHashMap、Atomic 类）。</li>
    </ol>
  </div>
);

const NO_DEADLOCK_HELP = (
  <div style={{ maxWidth: 420, fontSize: 13 }}>
    <p style={{ margin: '0 0 8px', fontWeight: 600 }}>死锁检测机制</p>
    <p style={{ margin: '0 0 6px', color: '#666' }}>
      本工具通过 <strong>DFS 三色标记</strong> 算法扫描线程等待图（Wait-For Graph）：
    </p>
    <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
      <li>解析 jstack 输出中每个线程的锁持有和等待信息</li>
      <li>构建有向图：节点=线程，边=A等待B</li>
      <li>DFS 检测环路 → 环路 = 死锁</li>
    </ol>
    <p style={{ margin: '8px 0 0', color: '#52c41a', fontWeight: 500 }}>
      ✅ 当前未检测到任何死锁环路，系统运行正常。
    </p>
    <p style={{ margin: '4px 0 0', color: '#999', fontSize: 12 }}>
      同时覆盖 synchronized (Monitor锁) 和 ReentrantLock (JUC锁) 两种场景。
    </p>
  </div>
);

// ================================================================
// 辅助函数
// ================================================================

/** 根据线程状态和等待类型判断死锁类别 */
function classifyDeadlockType(threads: ThreadSummary[]): DeadlockType {
  const hasMonitor = threads.some(
    t => t.state === 'BLOCKED' || t.waitingType === 'MONITOR'
  );
  const hasJuc = threads.some(
    t =>
      (t.state === 'WAITING' || t.state === 'TIMED_WAITING') &&
      t.waitingType === 'PARKING'
  );

  if (hasMonitor && hasJuc) return 'MIXED';
  if (hasJuc) return 'JUC_LOCK';
  return 'MONITOR';
}

function getTypeInfo(type: DeadlockType): { label: string; description: string } {
  switch (type) {
    case 'MONITOR':
      return {
        label: 'Monitor 死锁',
        description: '由 synchronized 关键字导致的经典死锁，线程状态为 BLOCKED，等待获取对象监视器锁',
      };
    case 'JUC_LOCK':
      return {
        label: 'JUC Lock 死锁',
        description: '由 java.util.concurrent.locks.ReentrantLock 等 JUC 锁导致的死锁，线程状态为 WAITING (parking)',
      };
    case 'MIXED':
      return {
        label: '混合死锁',
        description: '同时涉及 Monitor 锁和 JUC 锁的复杂死锁场景',
      };
  }
}

/** 截断锁地址显示 */
function formatLockAddress(addr: string): string {
  if (!addr) return '';
  return addr.length > 18 ? `${addr.substring(0, 9)}...${addr.substring(addr.length - 6)}` : addr;
}

/** 线程名截断 */
function truncateName(name: string, max: number = 24): string {
  return name.length > max ? `${name.substring(0, max - 3)}...` : name;
}

// ================================================================
// 组件
// ================================================================

const DeadlockDetail: React.FC<DeadlockDetailProps> = ({
  deadlockChain,
  threadState,
  lockGraph,
}) => {
  const { chains, descriptions } = deadlockChain;
  const { deadlockCount, threads } = threadState;

  // ========== 构建每条链路的分析数据 ==========
  const chainAnalyses: ChainAnalysis[] = useMemo(() => {
    if (!chains || chains.length === 0) return [];

    return chains.map((chain, idx) => {
      // 去重（chain 格式: [A, B, C, A]，首尾重复）
      const uniqueThreads = [...new Set(chain)];
      const threadDetails = uniqueThreads
        .map(name => threads.find(t => t.name === name))
        .filter((t): t is ThreadSummary => t != null);

      const deadlockType = classifyDeadlockType(threadDetails);
      const typeInfo = getTypeInfo(deadlockType);

      return {
        chainIndex: idx,
        chain,
        uniqueThreads,
        threadDetails,
        deadlockType,
        typeLabel: typeInfo.label,
        typeDescription: typeInfo.description,
      };
    });
  }, [chains, threads]);

  // ========== 全局死锁类型统计 ==========
  const typeStats = useMemo(() => {
    const stats: Record<DeadlockType, number> = { MONITOR: 0, JUC_LOCK: 0, MIXED: 0 };
    chainAnalyses.forEach(c => { stats[c.deadlockType]++; });
    return stats;
  }, [chainAnalyses]);

  // ========== 无死锁 ==========
  if (!deadlockChain.detected || chains.length === 0) {
    return (
      <div>
        <Card style={{ textAlign: 'center', padding: '60px 0' }}>
          <CheckCircleOutlined style={{ fontSize: 64, color: '#52c41a', marginBottom: 16 }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Title level={4} style={{ color: '#52c41a', margin: 0 }}>
              未检测到死锁
            </Title>
            <Popover content={NO_DEADLOCK_HELP} title="死锁检测说明" placement="top" trigger="hover">
              <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer', fontSize: 14 }} />
            </Popover>
          </div>
          <Paragraph type="secondary" style={{ marginTop: 12 }}>
            当前的 JVM 线程转储中不存在死锁环路，所有线程的锁获取顺序正常。
          </Paragraph>
          <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
            检测范围：Monitor 锁（synchronized）和 JUC Lock（ReentrantLock 等）
          </Paragraph>
        </Card>
      </div>
    );
  }

  return (
    <div>
      {/* ========== 死锁摘要 ========== */}
      <Alert
        type="error"
        showIcon
        icon={<BugOutlined />}
        message={
          <span style={{ fontWeight: 600, fontSize: 15 }}>
            检测到 {chains.length} 组死锁，涉及 {deadlockCount} 个线程
          </span>
        }
        description={
          <div style={{ marginTop: 8 }}>
            <Space size={16} wrap>
              {typeStats.MONITOR > 0 && (
                <Tag color="red" style={{ fontSize: 12, padding: '2px 10px' }}>
                  <LockOutlined /> {typeStats.MONITOR} 组 Monitor 死锁
                </Tag>
              )}
              {typeStats.JUC_LOCK > 0 && (
                <Tag color="orange" style={{ fontSize: 12, padding: '2px 10px' }}>
                  <SyncOutlined spin /> {typeStats.JUC_LOCK} 组 JUC Lock 死锁
                </Tag>
              )}
              {typeStats.MIXED > 0 && (
                <Tag color="volcano" style={{ fontSize: 12, padding: '2px 10px' }}>
                  <WarningOutlined /> {typeStats.MIXED} 组混合死锁
                </Tag>
              )}
            </Space>
          </div>
        }
        style={{ marginBottom: 24, borderRadius: 8 }}
      />

      {/* ========== 摘要指标卡 ========== */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Title level={5} style={{ margin: 0, fontSize: 15 }}>死锁摘要</Title>
        <Popover content={SUMMARY_HELP} title="指标说明" placement="topLeft" trigger="hover">
          <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer', fontSize: 14 }} />
        </Popover>
      </div>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={6}>
          <Card size="small">
            <Statistic
              title="死锁链路数"
              value={chains.length}
              prefix={<BugOutlined />}
              valueStyle={{ color: '#ff4d4f', fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card size="small">
            <Statistic
              title="涉及线程数"
              value={deadlockCount}
              prefix={<WarningOutlined />}
              valueStyle={{ color: '#ff4d4f', fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card size="small">
            <Statistic
              title="Monitor 锁"
              value={typeStats.MONITOR}
              prefix={<LockOutlined />}
              valueStyle={{ color: typeStats.MONITOR > 0 ? '#ff4d4f' : '#52c41a', fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card size="small">
            <Statistic
              title="JUC Lock"
              value={typeStats.JUC_LOCK}
              prefix={<SyncOutlined />}
              valueStyle={{ color: typeStats.JUC_LOCK > 0 ? '#ff4d4f' : '#52c41a', fontSize: 22 }}
            />
          </Card>
        </Col>
      </Row>

      {/* ========== 死锁链路详情 ========== */}
      {chainAnalyses.map((analysis) => (
        <Card
          key={analysis.chainIndex}
          style={{ marginBottom: 24 }}
          title={
            <Space size={12}>
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: CHAIN_COLORS[analysis.chainIndex % CHAIN_COLORS.length],
                }}
              />
              <Title level={5} style={{ margin: 0 }}>
                死锁链路 #{analysis.chainIndex + 1}
              </Title>
              <Tag
                color={
                  analysis.deadlockType === 'MONITOR' ? 'red' :
                  analysis.deadlockType === 'JUC_LOCK' ? 'orange' : 'volcano'
                }
              >
                {analysis.typeLabel}
              </Tag>
            </Space>
          }
          extra={
            <Tooltip title={analysis.typeDescription}>
              <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
            </Tooltip>
          }
        >
          {/* ---- 链路流程图 ---- */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
              <Text strong style={{ fontSize: 13 }}>死锁链路图</Text>
              <Popover content={FLOW_DIAGRAM_HELP} title="链路图阅读指南" placement="topLeft" trigger="hover">
                <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer', fontSize: 13 }} />
              </Popover>
            </div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
              {descriptions[analysis.chainIndex]}
            </Text>

            {/* 水平流向图 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexWrap: 'wrap',
                gap: 0,
                padding: '16px 0',
                background: '#fafafa',
                borderRadius: 8,
                overflow: 'auto',
              }}
            >
              {analysis.uniqueThreads.map((threadName, i) => {
                const thread = analysis.threadDetails.find(t => t.name === threadName);
                const color = STATE_COLOR_MAP[thread?.state || ''] || '#bfbfbf';
                const stateColor = analysis.deadlockType === 'MONITOR' ? '#ff4d4f' : '#fa8c16';
                return (
                  <React.Fragment key={threadName}>
                    {/* 线程节点 */}
                    <Tooltip
                      title={
                        <div>
                          <div>线程: {threadName}</div>
                          {thread && (
                            <>
                              <div>状态: {thread.state}</div>
                              {thread.waitingOnLock && (
                                <div>等待锁: {formatLockAddress(thread.waitingOnLock)}</div>
                              )}
                              {thread.lockedMonitors.length > 0 && (
                                <div>持有锁: {thread.lockedMonitors.map(formatLockAddress).join(', ')}</div>
                              )}
                            </>
                          )}
                          <div style={{ color: '#8cc8ff', marginTop: 4, fontSize: 11 }}>
                            💡 点击展开查看详情
                          </div>
                        </div>
                      }
                    >
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          padding: '8px 14px',
                          background: '#fff',
                          borderRadius: 8,
                          border: `2px solid ${color}`,
                          cursor: 'pointer',
                          minWidth: 80,
                          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                          transition: 'transform 0.2s, box-shadow 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.transform = 'scale(1.05)';
                          (e.currentTarget as HTMLElement).style.boxShadow = '0 3px 8px rgba(0,0,0,0.2)';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                          (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
                        }}
                        onClick={() => {
                          const panel = document.querySelector(`.deadlock-thread-${i}`);
                          if (panel) {
                            (panel as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
                          }
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            color: '#999',
                            marginBottom: 2,
                          }}
                        >
                          Thread-{i + 1}
                        </span>
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: '#333',
                            maxWidth: 120,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {truncateName(threadName)}
                        </span>
                        {thread && (
                          <Tag
                            color={stateColor}
                            style={{
                              fontSize: 10,
                              lineHeight: '16px',
                              padding: '0 6px',
                              marginTop: 4,
                            }}
                          >
                            {thread.state}
                          </Tag>
                        )}
                      </div>
                    </Tooltip>

                    {/* 箭头（非最后一个） */}
                    {i < analysis.uniqueThreads.length - 1 && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          margin: '0 4px',
                        }}
                      >
                        <div
                          style={{
                            width: 40,
                            height: 2,
                            background: '#d9d9d9',
                            position: 'relative',
                          }}
                        >
                          <div
                            style={{
                              position: 'absolute',
                              right: -6,
                              top: -5,
                              width: 0,
                              height: 0,
                              borderLeft: '8px solid #d9d9d9',
                              borderTop: '6px solid transparent',
                              borderBottom: '6px solid transparent',
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* 环形闭合箭头（回到第一个） */}
                    {i === analysis.uniqueThreads.length - 1 && (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          margin: '0 4px',
                          position: 'relative',
                        }}
                      >
                        <div style={{ fontSize: 10, color: '#ff4d4f', marginBottom: 2, fontWeight: 600 }}>
                          等待
                        </div>
                        <div style={{ position: 'relative', width: 50, height: 40 }}>
                          <svg width="50" height="40" viewBox="0 0 50 40">
                            <path
                              d="M 5 20 Q 5 5, 25 5 Q 45 5, 45 20"
                              fill="none"
                              stroke="#ff4d4f"
                              strokeWidth="2"
                              strokeDasharray="6,3"
                              markerEnd="url(#deadlock-arrow)"
                            />
                          </svg>
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>

            {/* 等待关系文字说明 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexWrap: 'wrap',
                gap: 4,
                marginTop: 8,
                fontSize: 11,
                color: '#666',
              }}
            >
              {analysis.uniqueThreads.map((name, i) => {
                const nextIdx = (i + 1) % analysis.uniqueThreads.length;
                const nextName = analysis.uniqueThreads[nextIdx];
                const thread = analysis.threadDetails.find(t => t.name === name);
                return (
                  <React.Fragment key={`wait-${i}`}>
                    <span style={{ fontWeight: 500, color: '#333' }}>
                      {truncateName(name, 14)}
                    </span>
                    <span style={{ color: '#ff4d4f' }}>
                      等待 ⟩
                    </span>
                    {thread?.waitingOnLockClass && (
                      <Tag
                        color="red"
                        style={{ fontSize: 10, lineHeight: '16px', padding: '0 6px', margin: '0 2px' }}
                      >
                        {thread.waitingOnLockClass.split('.').pop()}
                      </Tag>
                    )}
                    {i === analysis.uniqueThreads.length - 1 && (
                      <span style={{ fontWeight: 500, color: '#333' }}>
                        {truncateName(nextName, 14)}
                      </span>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          <Divider style={{ margin: '12px 0' }} />

          {/* ---- 线程详细分析 ---- */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <Title level={5} style={{ margin: 0, fontSize: 14 }}>
              {analysis.uniqueThreads.length} 个线程参与此死锁链路
            </Title>
            <Popover content={THREAD_DETAIL_HELP} title="线程详情解读" placement="topLeft" trigger="hover">
              <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer', fontSize: 13 }} />
            </Popover>
          </div>

          <Collapse
            className="deadlock-thread-collapse"
            style={{ background: '#fafafa' }}
          >
            {analysis.threadDetails.map((thread, i) => {
              // 找到此线程在链中等待的下一个线程
              const threadIdx = analysis.uniqueThreads.indexOf(thread.name);
              const nextThreadName = analysis.uniqueThreads[
                (threadIdx + 1) % analysis.uniqueThreads.length
              ];
              const nextThread = analysis.threadDetails.find(
                t => t.name === nextThreadName
              );

              return (
                <Panel
                  key={thread.name}
                  className={`deadlock-thread-${i}`}
                  header={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: 13,
                          fontFamily: 'Menlo, Monaco, Consolas, monospace',
                          color: '#1a1a1a',
                        }}
                      >
                        {thread.name}
                      </span>
                      <Tag
                        color={
                          thread.state === 'BLOCKED' ? 'red' :
                          thread.state === 'WAITING' ? 'orange' :
                          thread.state === 'TIMED_WAITING' ? 'gold' :
                          'default'
                        }
                        style={{ fontSize: 11 }}
                      >
                        {thread.state}
                        {STATE_LABEL_MAP[thread.state] && ` (${STATE_LABEL_MAP[thread.state]})`}
                      </Tag>
                      {thread.waitingType && (
                        <Tag
                          color={
                            thread.waitingType === 'MONITOR' ? 'red' :
                            thread.waitingType === 'PARKING' ? 'orange' : 'geekblue'
                          }
                          style={{ fontSize: 10 }}
                        >
                          {thread.waitingType === 'MONITOR' ? 'synchronized' :
                           thread.waitingType === 'PARKING' ? 'ReentrantLock' :
                           thread.waitingType}
                        </Tag>
                      )}
                      {thread.nid && (
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          nid={thread.nid}
                        </Text>
                      )}
                    </div>
                  }
                  extra={
                    <BugOutlined style={{ color: '#ff4d4f' }} />
                  }
                >
                  {/* 锁信息 */}
                  <div
                    style={{
                      background: '#fff',
                      borderRadius: 8,
                      padding: '12px 16px',
                      marginBottom: 12,
                      border: '1px solid #f0f0f0',
                    }}
                  >
                    <div style={{ marginBottom: 8 }}>
                      <Text strong style={{ fontSize: 12, color: '#999' }}>
                        当前等待 (WAITING FOR):
                      </Text>
                      {thread.waitingOnLock ? (
                        <div style={{ marginTop: 4 }}>
                          <Space size={8}>
                            <Tag color="red" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                              {formatLockAddress(thread.waitingOnLock)}
                            </Tag>
                            {thread.waitingOnLockClass && (
                              <Tag color="volcano" style={{ fontSize: 11 }}>
                                {thread.waitingOnLockClass.split('.').pop()}
                              </Tag>
                            )}
                          </Space>
                          {nextThread && (
                            <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
                              被线程 <Text strong style={{ color: '#333' }}>{truncateName(nextThreadName)}</Text> 持有
                            </Text>
                          )}
                        </div>
                      ) : (
                        <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>无</Text>
                      )}
                    </div>

                    <div>
                      <Text strong style={{ fontSize: 12, color: '#999' }}>
                        当前持有 (LOCKED):
                      </Text>
                      {thread.lockedMonitors.length > 0 ? (
                        <div style={{ marginTop: 4 }}>
                          {thread.lockedMonitors.map((addr, idx) => (
                            <div key={addr} style={{ marginBottom: 4 }}>
                              <Space size={8}>
                                <Tag
                                  color="green"
                                  style={{ fontFamily: 'monospace', fontSize: 11 }}
                                >
                                  {formatLockAddress(addr)}
                                </Tag>
                                {thread.lockedMonitorClasses?.[idx] && (
                                  <Tag color="cyan" style={{ fontSize: 11 }}>
                                    {thread.lockedMonitorClasses[idx].split('.').pop()}
                                  </Tag>
                                )}
                              </Space>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>无</Text>
                      )}
                    </div>
                  </div>

                  {/* 堆栈跟踪 */}
                  <div>
                    <Text strong style={{ fontSize: 12, color: '#999', marginBottom: 8, display: 'block' }}>
                      堆栈跟踪:
                    </Text>
                    <div
                      style={{
                        background: '#1e1e1e',
                        color: '#d4d4d4',
                        borderRadius: 6,
                        padding: '12px 16px',
                        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                        fontSize: 11,
                        lineHeight: 1.8,
                        maxHeight: 280,
                        overflow: 'auto',
                      }}
                    >
                      {thread.waitingOnLock && thread.waitingType && (
                        <div style={{ color: '#f48771', marginBottom: 4 }}>
                          {thread.waitingType === 'MONITOR'
                            ? `- waiting to lock <${thread.waitingOnLock}>`
                            : `- parking to wait for  <${thread.waitingOnLock}>`}
                          {thread.waitingOnLockClass && ` (a ${thread.waitingOnLockClass})`}
                        </div>
                      )}
                      {thread.stackTrace.map((frame, fi) => (
                        <div
                          key={fi}
                          style={{
                            color: fi === 0 ? '#f48771' : '#d4d4d4',
                            paddingLeft: 16,
                          }}
                        >
                          at {frame}
                        </div>
                      ))}
                      {thread.lockedMonitors.map((addr, idx) => (
                        <div
                          key={`locked-${idx}`}
                          style={{ color: '#6a9955', marginTop: 4 }}
                        >
                          - locked &lt;{addr}&gt;
                          {thread.lockedMonitorClasses?.[idx] &&
                            ` (a ${thread.lockedMonitorClasses[idx]})`}
                        </div>
                      ))}
                    </div>
                  </div>
                </Panel>
              );
            })}
          </Collapse>

          {/* ---- 解决建议 ---- */}
          <Alert
            type="warning"
            showIcon
            icon={<WarningOutlined />}
            message={
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>死锁解决建议</span>
                <Popover content={SOLUTION_HELP} title="解决策略" placement="topRight" trigger="hover">
                  <QuestionCircleOutlined style={{ color: '#ad8b00', cursor: 'pointer', fontSize: 13 }} />
                </Popover>
              </div>
            }
            description={
              <ul style={{ margin: '4px 0', paddingLeft: 18, lineHeight: 2, fontSize: 13 }}>
                <li>
                  <strong>统一加锁顺序</strong>：确保所有线程按相同的全局顺序获取锁，打破循环等待条件。
                </li>
                {analysis.deadlockType === 'MONITOR' && (
                  <li>
                    <strong>缩小同步块范围</strong>：减少 synchronized 代码块的大小，降低锁持有的时间窗口。
                  </li>
                )}
                {analysis.deadlockType === 'JUC_LOCK' && (
                  <li>
                    <strong>使用 tryLock(timeout)</strong>：将 <code>lock()</code> 替换为 <code>tryLock(long, TimeUnit)</code>，
                    设置合理的超时时间，避免无限期等待。
                  </li>
                )}
                <li>
                  <strong>减小锁粒度</strong>：使用细粒度锁（如 <code>ConcurrentHashMap</code> 的分段锁）
                  或锁拆分（Lock Splitting）降低锁竞争。
                </li>
                <li>
                  <strong>使用无锁数据结构</strong>：考虑使用并发集合（ConcurrentHashMap、CopyOnWriteArrayList）
                  或原子变量（AtomicInteger、AtomicReference）替代显式加锁。
                </li>
              </ul>
            }
            style={{ marginTop: 16, borderRadius: 8 }}
          />
        </Card>
      ))}

      {/* ========== 死锁检测算法说明 ========== */}
      <Card
        size="small"
        style={{ background: '#f9f9f9' }}
        title={
          <Space>
            <QuestionCircleOutlined style={{ color: '#999' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>检测算法说明</Text>
          </Space>
        }
      >
        <Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
          死锁检测基于 <strong>DFS 三色标记</strong>有向图环路检测算法：
          构建线程等待图（Thread Wait-For Graph），节点为线程，有向边表示"线程 A 等待线程 B 持有的锁"，
          通过 DFS 遍历在 O(V+E) 时间复杂度内识别所有环路。支持检测 <strong>Monitor 锁</strong>
          （synchronized）和 <strong>JUC Lock</strong>（ReentrantLock 等）两种类型的死锁。
        </Paragraph>
      </Card>
    </div>
  );
};

export default DeadlockDetail;
