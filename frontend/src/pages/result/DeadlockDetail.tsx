import React, { useMemo } from 'react';
import {
  Card, Typography, Alert, Tag, Collapse, Divider, Empty, Space, Row, Col, Statistic, Tooltip, Popover,
} from 'antd';
import {
  BugOutlined, LockOutlined, SyncOutlined, RightOutlined, WarningOutlined,
  CheckCircleOutlined, QuestionCircleOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
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

const CHAIN_COLORS = ['#1677ff', '#722ed1', '#13c2c2', '#eb2f96', '#fa8c16'];

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

function getTypeInfo(type: DeadlockType, t: (key: string) => string): { label: string; description: string } {
  switch (type) {
    case 'MONITOR':
      return {
        label: t('deadlock.chainTypeMonitor'),
        description: t('deadlock.chainTypeMonitorDesc'),
      };
    case 'JUC_LOCK':
      return {
        label: t('deadlock.chainTypeJuc'),
        description: t('deadlock.chainTypeJucDesc'),
      };
    case 'MIXED':
      return {
        label: t('deadlock.chainTypeMixed'),
        description: t('deadlock.chainTypeMixedDesc'),
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
  const { t } = useTranslation();
  const { chains, descriptions } = deadlockChain;
  const { deadlockCount, threads } = threadState;

  const stateLabel = (state: string): string => {
    const map: Record<string, string> = {
      RUNNABLE: t('overview.stateRunnable'),
      BLOCKED: t('overview.stateBlocked'),
      WAITING: t('overview.stateWaiting'),
      TIMED_WAITING: t('overview.stateTimedWaiting'),
      TERMINATED: t('overview.stateTerminated'),
      NEW: t('overview.stateNew'),
      UNKNOWN: t('overview.stateUnknown'),
    };
    return map[state] || state;
  };

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
      const typeInfo = getTypeInfo(deadlockType, t);

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
  }, [chains, threads, t]);

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
              {t('deadlock.noDeadlockTitle')}
            </Title>
            <Popover content={
              <div style={{ maxWidth: 420, fontSize: 13 }}>
                <p style={{ margin: '0 0 6px', color: '#666' }}>
                  {t('deadlock.algorithmContent')}
                </p>
                <p style={{ margin: '8px 0 0', color: '#52c41a', fontWeight: 500 }}>
                  ✅ {t('deadlock.noDeadlockTitle')}
                </p>
              </div>
            } title={t('deadlock.algorithmTitle')} placement="top" trigger="hover">
              <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer', fontSize: 14 }} />
            </Popover>
          </div>
          <Paragraph type="secondary" style={{ marginTop: 12 }}>
            {t('deadlock.noDeadlockDesc')}
          </Paragraph>
          <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
            {t('deadlock.noDeadlockRange')}
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
            {t('deadlock.deadlockAlert', { count: chains.length, threads: deadlockCount })}
          </span>
        }
        description={
          <div style={{ marginTop: 8 }}>
            <Space size={16} wrap>
              {typeStats.MONITOR > 0 && (
                <Tag color="red" style={{ fontSize: 12, padding: '2px 10px' }}>
                  <LockOutlined /> {t('deadlock.monitorDeadlock', { count: typeStats.MONITOR })}
                </Tag>
              )}
              {typeStats.JUC_LOCK > 0 && (
                <Tag color="orange" style={{ fontSize: 12, padding: '2px 10px' }}>
                  <SyncOutlined spin /> {t('deadlock.jucDeadlock', { count: typeStats.JUC_LOCK })}
                </Tag>
              )}
              {typeStats.MIXED > 0 && (
                <Tag color="volcano" style={{ fontSize: 12, padding: '2px 10px' }}>
                  <WarningOutlined /> {t('deadlock.mixedDeadlock', { count: typeStats.MIXED })}
                </Tag>
              )}
            </Space>
          </div>
        }
        style={{ marginBottom: 24, borderRadius: 8 }}
      />

      {/* ========== 摘要指标卡 ========== */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Title level={5} style={{ margin: 0, fontSize: 15 }}>{t('deadlock.summaryTitle')}</Title>
        <Popover content={
          <div style={{ maxWidth: 520, fontSize: 13 }}>
            <p style={{ margin: '0 0 8px', fontWeight: 600 }}>{t('deadlock.summaryHelp')}</p>
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
              <li><strong>{t('deadlock.summaryDeadlockChains')}</strong>：{t('deadlock.summaryHelpContent')}</li>
              <li><strong>{t('deadlock.summaryThreads')}</strong>：{t('deadlock.summaryHelpContent')}</li>
            </ul>
          </div>
        } title={t('deadlock.summaryHelp')} placement="topLeft" trigger="hover">
          <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer', fontSize: 14 }} />
        </Popover>
      </div>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={6}>
          <Card size="small">
            <Statistic
              title={t('deadlock.summaryDeadlockChains')}
              value={chains.length}
              prefix={<BugOutlined />}
              valueStyle={{ color: '#ff4d4f', fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card size="small">
            <Statistic
              title={t('deadlock.summaryThreads')}
              value={deadlockCount}
              prefix={<WarningOutlined />}
              valueStyle={{ color: '#ff4d4f', fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card size="small">
            <Statistic
              title={t('deadlock.summaryMonitor')}
              value={typeStats.MONITOR}
              prefix={<LockOutlined />}
              valueStyle={{ color: typeStats.MONITOR > 0 ? '#ff4d4f' : '#52c41a', fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card size="small">
            <Statistic
              title={t('deadlock.summaryJuc')}
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
                {t('deadlock.chainTitle', { num: analysis.chainIndex + 1 })}
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
              <Text strong style={{ fontSize: 13 }}>{t('deadlock.flowDiagramTitle')}</Text>
              <Popover content={
                <div style={{ maxWidth: 480, fontSize: 13 }}>
                  <p style={{ margin: '0 0 8px', fontWeight: 600 }}>{t('deadlock.flowDiagramHelp')}</p>
                  <p style={{ margin: '0 0 6px', color: '#666' }}>
                    {t('deadlock.flowDiagramHelpContent')}
                  </p>
                </div>
              } title={t('deadlock.flowDiagramHelp')} placement="topLeft" trigger="hover">
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
                          <div>{t('threads.threadName')}: {threadName}</div>
                          {thread && (
                            <>
                              <div>{t('threads.state')}: {thread.state}</div>
                              {thread.waitingOnLock && (
                                <div>{t('deadlock.waitingFor').replace(':','')}: {formatLockAddress(thread.waitingOnLock)}</div>
                              )}
                              {thread.lockedMonitors.length > 0 && (
                                <div>{t('deadlock.locked').replace(':','')}: {thread.lockedMonitors.map(formatLockAddress).join(', ')}</div>
                              )}
                            </>
                          )}
                          <div style={{ color: '#8cc8ff', marginTop: 4, fontSize: 11 }}>
                            {t('deadlock.clickExpand')}
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
                          {t('deadlock.flowWaiting')}
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
                      {t('deadlock.flowWaiting')} ⟩
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
              {t('deadlock.threadDetailTitle', { count: analysis.uniqueThreads.length })}
            </Title>
            <Popover content={
              <div style={{ maxWidth: 500, fontSize: 13 }}>
                <p style={{ margin: '0 0 8px', fontWeight: 600 }}>{t('deadlock.threadDetailHelp')}</p>
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
                  <li><strong>{t('deadlock.waitingFor')}</strong></li>
                  <li><strong>{t('deadlock.locked')}</strong></li>
                  <li><strong>{t('deadlock.stackTrace')}</strong>
                    <ul style={{ margin: '2px 0 0', paddingLeft: 18, lineHeight: 1.8 }}>
                      <li><span style={{ color: '#f48771' }}>{t('deadlock.redLine')}</span></li>
                      <li><span style={{ color: '#6a9955' }}>{t('deadlock.greenLine')}</span></li>
                      <li>{t('deadlock.stackTop')}</li>
                    </ul>
                  </li>
                </ul>
              </div>
            } title={t('deadlock.threadDetailHelp')} placement="topLeft" trigger="hover">
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
                        {stateLabel(thread.state) && ` (${stateLabel(thread.state)})`}
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
                        {t('deadlock.waitingFor')}
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
                              {t('deadlock.heldBy', { name: truncateName(nextThreadName) })}
                            </Text>
                          )}
                        </div>
                      ) : (
                        <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>{t('deadlock.noWaiting')}</Text>
                      )}
                    </div>

                    <div>
                      <Text strong style={{ fontSize: 12, color: '#999' }}>
                        {t('deadlock.locked')}
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
                        <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>{t('deadlock.noLocked')}</Text>
                      )}
                    </div>
                  </div>

                  {/* 堆栈跟踪 */}
                  <div>
                    <Text strong style={{ fontSize: 12, color: '#999', marginBottom: 8, display: 'block' }}>
                      {t('deadlock.stackTrace')}
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
                <span>{t('deadlock.solutionTitle')}</span>
                <Popover content={
                  <div style={{ maxWidth: 520, fontSize: 13 }}>
                    <p style={{ margin: '0 0 8px', fontWeight: 600 }}>{t('deadlock.solutionHelp')}</p>
                    <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
                      <li><strong>{t('deadlock.solutionBreakCycle')}</strong></li>
                      <li><strong>{t('deadlock.solutionBreakHold')}</strong></li>
                      <li><strong>{t('deadlock.solutionReduce')}</strong></li>
                      <li><strong>{t('deadlock.solutionLockFree')}</strong></li>
                    </ol>
                  </div>
                } title={t('deadlock.solutionHelp')} placement="topRight" trigger="hover">
                  <QuestionCircleOutlined style={{ color: '#ad8b00', cursor: 'pointer', fontSize: 13 }} />
                </Popover>
              </div>
            }
            description={
              <ul style={{ margin: '4px 0', paddingLeft: 18, lineHeight: 2, fontSize: 13 }}>
                <li>
                  <strong>{t('deadlock.solutionBreakCycle')}</strong>
                </li>
                {analysis.deadlockType === 'MONITOR' && (
                  <li>
                    <strong>{t('deadlock.solutionShrinkSync')}</strong>
                  </li>
                )}
                {analysis.deadlockType === 'JUC_LOCK' && (
                  <li>
                    <strong>{t('deadlock.solutionTryLock')}</strong>
                  </li>
                )}
                <li>
                  <strong>{t('deadlock.solutionFineGrain')}</strong>
                </li>
                <li>
                  <strong>{t('deadlock.solutionLockFree')}</strong>
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
            <Text type="secondary" style={{ fontSize: 12 }}>{t('deadlock.algorithmTitle')}</Text>
          </Space>
        }
      >
        <Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
          {t('deadlock.algorithmContent')}
        </Paragraph>
      </Card>
    </div>
  );
};

export default DeadlockDetail;
