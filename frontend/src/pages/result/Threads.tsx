import React, { useMemo, useState, useEffect } from 'react';
import { Card, Table, Tag, Typography, Empty, Popover, Modal, Input, message, Tooltip, Spin } from 'antd';
import { SearchOutlined, BugOutlined, QuestionCircleOutlined, CopyOutlined, ExclamationCircleOutlined, WarningOutlined, InfoCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import type { ThreadSummary, StackGroupVO } from '../../types';

const { Title, Text, Paragraph } = Typography;

// ========== 类型 ==========

/** 相同堆栈分组 */
interface StackGroup {
  key: string;           // stackTrace.join 后的唯一 key
  count: number;          // 该组线程数
  sampleThread: ThreadSummary;
  allThreads: ThreadSummary[];
  allThreadNames: string[];
  firstFrame: string;     // 第一帧（代表栈帧）
  secondFrame: string;    // 第二帧（如有）
  states: Record<string, number>; // 状态分布
}

// ========== 常量 ==========

const stateColorMap: Record<string, string> = {
  RUNNABLE: 'blue',
  BLOCKED: 'red',
  WAITING: 'orange',
  TIMED_WAITING: 'default',
  TERMINATED: 'default',
  NEW: 'green',
  UNKNOWN: 'default',
};

// ========== 锁信息渲染辅助 ==========

/**
 * 还原原始 jstack 格式的调用栈行（含锁信息穿插）
 * 例如：
 *   at sun.misc.Unsafe.park(Native Method)
 *   - parking to wait for  <0x00000006e9355388> (a java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject)
 *   at java.util.concurrent.locks.LockSupport.park(LockSupport.java:175)
 */
function buildRawStackLines(thread: ThreadSummary): string[] {
  const lines: string[] = [];
  if (!thread.stackTrace) return lines;
  // waitingOnLock 通常出现在第一个 at 帧之后
  const hasWaitingLock = !!thread.waitingOnLock;
  let waitingInserted = false;

  for (let i = 0; i < thread.stackTrace.length; i++) {
    // at 帧行
    lines.push(`at ${thread.stackTrace[i]}`);

    // waiting lock 插入在第一帧之后
    if (!waitingInserted && hasWaitingLock && i === 0) {
      waitingInserted = true;
      let lockLine = '';
      if (thread.state === 'BLOCKED') {
        lockLine = '- waiting to lock';
      } else {
        lockLine = '- parking to wait for';
      }
      lockLine += `  <${thread.waitingOnLock}>`;
      if (thread.waitingOnLockClass) {
        lockLine += ` (a ${thread.waitingOnLockClass})`;
      }
      lines.push(lockLine);
    }
  }

  // locked monitors 追加在末尾
  thread.lockedMonitors?.forEach((addr, idx) => {
    let line = `- locked <${addr}>`;
    if (thread.lockedMonitorClasses?.[idx]) {
      line += ` (a ${thread.lockedMonitorClasses[idx]})`;
    }
    lines.push(line);
  });

  return lines;
}

/** 渲染线程的锁信息区域（用于独立的锁信息展示） */
const LockInfoSection: React.FC<{ thread: ThreadSummary }> = ({ thread }) => {
  const hasWaiting = !!thread.waitingOnLock;
  const hasLocked = (thread.lockedMonitors?.length || 0) > 0;
  if (!hasWaiting && !hasLocked) return null;

  const waitingTypeLabel: Record<string, string> = {
    MONITOR: 'waiting to lock',
    PARKING: 'parking to wait for',
    OBJECT_WAIT: 'waiting on',
  };

  return (
    <div style={{ marginTop: 8, marginBottom: 4 }}>
      {/* 等待锁 */}
      {hasWaiting && (
        <div style={{ padding: '4px 0' }}>
          <span style={{ color: '#ce9178', fontWeight: 600 }}>
            - {waitingTypeLabel[thread.state === 'BLOCKED' ? 'MONITOR' : 'PARKING'] || 'waiting on'}{' '}
            &lt;{thread.waitingOnLock}&gt;
          </span>
          {thread.waitingOnLockClass && (
            <span style={{ color: '#6a9955' }}> (a {thread.waitingOnLockClass})</span>
          )}
        </div>
      )}
      {/* 持有锁 */}
      {thread.lockedMonitors?.map((addr, i) => (
        <div key={i} style={{ padding: '2px 0' }}>
          <span style={{ color: '#569cd6', fontWeight: 600 }}>
            - locked &lt;{addr}&gt;
          </span>
          {thread.lockedMonitorClasses?.[i] && (
            <span style={{ color: '#6a9955' }}> (a {thread.lockedMonitorClasses[i]})</span>
          )}
        </div>
      ))}
    </div>
  );
};

// ========== 组件 ==========

/**
 * 相同堆栈分析卡片
 */
const StackGroupAnalysis: React.FC<{ threads: ThreadSummary[]; stackGroups?: StackGroupVO[] | null }> = ({ threads, stackGroups }) => {
  const { t } = useTranslation();
  const [searchText, setSearchText] = useState('');
  const [modalGroup, setModalGroup] = useState<StackGroupVO | StackGroup | null>(null);

  // 优先使用后端预分组数据
  const groups = useMemo<(StackGroupVO | StackGroup)[]>(() => {
    if (stackGroups) {
      return stackGroups.filter((g) => {
        if (!searchText) return true;
        const kw = searchText.toLowerCase();
        return g.firstFrame.toLowerCase().includes(kw)
          || g.secondFrame.toLowerCase().includes(kw)
          || g.sampleThread.stackTrace?.some((f) => f.toLowerCase().includes(kw));
      });
    }
    // 降级：前端自行分组
    const map = new Map<string, ThreadSummary[]>();
    threads.forEach((t) => {
      const key = t.stackTrace ? t.stackTrace.join('\x00') : '(no stack)';
      const arr = map.get(key);
      if (arr) arr.push(t);
      else map.set(key, [t]);
    });
    const result: StackGroup[] = [];
    map.forEach((arr, key) => {
      const states: Record<string, number> = {};
      arr.forEach((t) => {
        states[t.state] = (states[t.state] || 0) + 1;
      });
      result.push({
        key,
        count: arr.length,
        sampleThread: arr[0],
        allThreads: arr,
        allThreadNames: arr.map(t => t.name),
        firstFrame: arr[0].stackTrace?.[0] || t('threads.noFrame'),
        secondFrame: arr[0].stackTrace?.[1] || '',
        states,
      });
    });
    result.sort((a, b) => b.count - a.count);
    return result;
  }, [threads, stackGroups, searchText, t]);

  const totalGroups = groups.length;
  const topGroup = groups[0];
  const topGroupPct = topGroup ? ((topGroup.count / threads.length) * 100).toFixed(1) : '0';

  const columns: ColumnsType<StackGroup | StackGroupVO> = [
    {
      title: t('threads.count'),
      dataIndex: 'count',
      key: 'count',
      width: 90,
      sorter: (a, b) => a.count - b.count,
      defaultSortOrder: 'descend',
      render: (count: number) => (
        <span style={{ fontWeight: 700, color: count > threads.length * 0.3 ? '#ff4d4f' : count > 10 ? '#fa8c16' : '#52c41a' }}>
          {count}
        </span>
      ),
    },
    {
      title: (
        <span>
          {t('overview.frames')} <span style={{ fontSize: 11, color: '#999', fontWeight: 400 }}>{t('threads.stackGroupClickDetail')}</span>
        </span>
      ),
      key: 'frames',
      ellipsis: true,
      render: (_: unknown, g: StackGroup | StackGroupVO) => (
        <div>
          <div style={{ fontFamily: "'Fira Code','Consolas',monospace", fontSize: 12, color: '#1890ff' }}>
            {g.firstFrame}
          </div>
          {g.secondFrame && (
            <div style={{ fontFamily: "'Fira Code','Consolas',monospace", fontSize: 11, color: '#888' }}>
              ↳ {g.secondFrame}
            </div>
          )}
        </div>
      ),
    },
    {
      title: t('threads.state'),
      key: 'states',
      width: 140,
      render: (_: unknown, g: StackGroup | StackGroupVO) => (
        <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {Object.entries(g.states).map(([s, c]) => (
            <Tag
              key={s}
              color={stateColorMap[s] || 'default'}
              style={{ fontWeight: 600, margin: 0 }}
            >
              {s} {c}
            </Tag>
          ))}
        </span>
      ),
    },
    {
      title: t('threads.threadName'),
      key: 'names',
      ellipsis: true,
      render: (_: unknown, g: StackGroup | StackGroupVO) => (
        <span style={{ fontSize: 12, color: '#666' }}>
          {g.allThreadNames.slice(0, 3).join(', ')}
          {g.allThreadNames.length > 3 && t('threads.andNMore', { count: g.allThreadNames.length })}
        </span>
      ),
    },
  ];

  return (
    <Card
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Title level={5} style={{ margin: 0 }}>
            {t('threads.sameStackTitle')}
          </Title>
          <Tag color={parseFloat(topGroupPct) > 30 ? 'red' : 'blue'} style={{ fontSize: 11, margin: 0 }}>
            {t('threads.maxGroup', { count: topGroup?.count || 0, pct: topGroupPct })}
          </Tag>
        </span>
      }
      extra={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Popover
            content={
              <div style={{ maxWidth: 400 }}>
                <p style={{ margin: '0 0 8px' }}>{t('threads.sameStackHelp')}</p>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  <li>{t('threads.sameStackHelpPrinciple')}</li>
                  <li>{t('threads.sameStackHelpFrame')}</li>
                  <li>{t('threads.sameStackHelpSearch')}</li>
                  <li>{t('threads.sameStackHelpSort')}</li>
                </ul>
                <p style={{ margin: '8px 0 0', color: '#999', fontSize: 12 }}>
                  {t('threads.sameStackHelpSevere')}
                </p>
              </div>
            }
            title={t('threads.sameStackHelpTitle')} placement="topRight"
          >
            <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
          </Popover>
          <Input
            prefix={<SearchOutlined style={{ color: '#bbb' }} />}
            placeholder={t('threads.searchPlaceholder')}
            allowClear
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 260, fontSize: 13 }}
            size="small"
          />
        </div>
      }
      style={{ marginBottom: 16 }}
    >
      {groups.length === 0 ? (
        <Empty description={t('threads.emptyStackGroup')} style={{ padding: 20 }} />
      ) : (
        <Table
          dataSource={groups}
          columns={columns}
          rowKey="key"
          size="middle"
          pagination={{
            defaultPageSize: 10,
            showSizeChanger: true,
            pageSizeOptions: [10, 15, 20, 50],
            showTotal: (total) => t('threads.totalStackGroups', { total }),
          }}
          onRow={(record) => ({
            onClick: () => setModalGroup(record),
            style: { cursor: 'pointer' },
          })}
          scroll={{ x: 700 }}
        />
      )}

      {/* 详情 Modal */}
      <Modal
        title={t('threads.stackGroupDetail', { count: modalGroup?.count })}
        open={!!modalGroup}
        onCancel={() => setModalGroup(null)}
        footer={null}
        width={720}
      >
        {modalGroup && (
          <div>
            {/* 状态分布 */}
            <div style={{ marginBottom: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(modalGroup.states).map(([s, c]) => (
                <Tag key={s} color={stateColorMap[s] || 'default'} style={{ fontWeight: 600, padding: '2px 10px' }}>
                  {t('threads.stateCount', { state: s, count: c })}
                </Tag>
              ))}
            </div>

            {/* 锁信息（独立展示，仅在原始栈中已有时不重复显示） */}

            {/* 完整调用栈（原始 jstack 格式） */}
            <div style={{ marginBottom: 12 }}>
              <Text strong style={{ fontSize: 13, marginBottom: 6, display: 'block' }}>
                {t('threads.stackTrace')}
              </Text>
              <pre
                style={{
                  background: '#1e1e1e',
                  color: '#d4d4d4',
                  padding: 16,
                  borderRadius: 8,
                  fontSize: 12,
                  lineHeight: 1.8,
                  maxHeight: 360,
                  overflow: 'auto',
                  fontFamily: "'Fira Code', 'Consolas', 'Courier New', monospace",
                }}
              >
                {buildRawStackLines(modalGroup.sampleThread).map((line, i) => {
                  const isAtLine = line.startsWith('at ');
                  const isWaitingLine = line.startsWith('- waiting to lock') || line.startsWith('- parking to wait');
                  const isLockedLine = line.startsWith('- locked');
                  let color = '#d4d4d4';
                  if (isAtLine) color = '#dcdcaa';
                  else if (isLockedLine) color = '#569cd6';
                  else if (isWaitingLine) color = '#ce9178';
                  return (
                    <div key={i} style={{ color }}>
                      {line}
                    </div>
                  );
                })}
              </pre>
            </div>

            {/* 线程名列表 */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text strong style={{ fontSize: 13 }}>{t('threads.threadNames', { count: modalGroup.allThreadNames.length })}</Text>
                <span
                  onClick={() => {
                    const text = modalGroup.allThreadNames.join('\n');
                    navigator.clipboard?.writeText(text).then(() => {
                      message.success(t('threads.copyNamesSuccess'));
                    }).catch(() => message.error(t('threads.copyNamesFail')));
                  }}
                  style={{ cursor: 'pointer', fontSize: 12, color: '#1890ff' }}
                >
                  <CopyOutlined /> {t('threads.copyAll')}
                </span>
              </div>
              <div
                style={{
                  background: '#fafafa',
                  padding: '8px 12px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontFamily: "'Fira Code','Consolas',monospace",
                  maxHeight: 200,
                  overflow: 'auto',
                  color: '#333',
                }}
              >
                {modalGroup.allThreadNames.map((name, i) => (
                  <div key={i} style={{ padding: '2px 0' }}>
                    {name}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
};

// ========== 懒加载调用栈 ==========

/**
 * 按需加载线程完整调用栈。
 * 通过分桶索引 + 缓存避免每次展开都请求后端。
 */
const LazyStackTrace: React.FC<{
  threadsIdx: Record<number, number>;
  bucketCache: Map<number, ThreadSummary[]>;
  loadBucket: (bucket: number) => void;
  tid: number;
}> = ({ threadsIdx, bucketCache, loadBucket, tid }) => {
  const { t } = useTranslation();

  const bucket = threadsIdx[tid];
  const cached = bucket != null ? bucketCache.get(bucket) : undefined;
  const detail = cached?.find(d => d.tid === tid);

  // 缓存未命中 → 触发加载
  useEffect(() => {
    if (bucket != null && !cached) {
      loadBucket(bucket);
    }
  }, [bucket, cached, loadBucket]);

  if (bucket == null) {
    return <Text type="secondary">tid={tid} {t('threads.noFrame')}</Text>;
  }

  if (!cached) {
    return <div style={{ textAlign: 'center', padding: 20 }}><Spin tip={t('threads.loading')} /></div>;
  }

  if (!detail || !detail.stackTrace || detail.stackTrace.length === 0) {
    return <Text type="secondary">{t('threads.noFrame')}</Text>;
  }

  const rawLines = buildRawStackLines(detail);
  return (
    <div style={{ padding: '4px 0' }}>
      <Text strong style={{ fontSize: 13 }}>
        {t('threads.stackTrace')}（{t('threads.stackFrameCount', { count: detail.stackTrace.length })}）
      </Text>
      <pre
        style={{
          background: '#1e1e1e',
          color: '#d4d4d4',
          padding: 16,
          borderRadius: 8,
          fontSize: 12,
          lineHeight: 1.8,
          maxHeight: 400,
          overflow: 'auto',
          fontFamily: "'Fira Code', 'Consolas', 'Courier New', monospace",
        }}
      >
        {rawLines.map((line, i) => {
          const isAtLine = line.startsWith('at ');
          const isWaitingLine = line.startsWith('- waiting to lock') || line.startsWith('- parking to wait');
          const isLockedLine = line.startsWith('- locked');
          let color = '#d4d4d4';
          if (isAtLine) color = '#dcdcaa';
          else if (isLockedLine) color = '#569cd6';
          else if (isWaitingLine) color = '#ce9178';
          return (
            <div key={i} style={{ color }}>
              {line}
            </div>
          );
        })}
      </pre>
    </div>
  );
};

// ========== 线程列表 ==========

const ThreadList: React.FC<{
  threads: ThreadSummary[];
  deadlockCount?: number;
  reportId?: string;
  threadsIdx?: Record<number, number> | null;
  bucketCache?: Map<number, ThreadSummary[]>;
  loadBucket?: (bucket: number) => void;
}> = ({ threads, deadlockCount, reportId, threadsIdx, bucketCache, loadBucket }) => {
  const { t } = useTranslation();
  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState<null | 'deadlock' | 'finalizerTrap' | 'throwingException'>(null);

  const filtered = (searchText || filterType)
    ? threads.filter((t) => {
        if (filterType === 'deadlock' && !t.inDeadlock) return false;
        if (filterType === 'finalizerTrap' && !t.finalizerTrapped) return false;
        if (filterType === 'throwingException' && !t.throwingException) return false;
        if (searchText) {
          const q = searchText.toLowerCase();
          return (
            t.name.toLowerCase().includes(q) ||
            t.state.toLowerCase().includes(q) ||
            t.stackTrace?.some((f) => f.toLowerCase().includes(q))
          );
        }
        return true;
      })
    : threads;

  const detectionRefPopover = (
    <Popover
      content={
        <div style={{ fontSize: 13, lineHeight: 2, maxWidth: 340 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('detectionRefTitle')}</div>
          <div style={{ color: '#666', marginBottom: 10 }}>{t('detectionRefDesc')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div>
              <Tag color="red" style={{ fontSize: 12 }}>⚠ {t('deadlockTag')}</Tag>
              <span style={{ color: '#666' }}>{t('detectionRefDeadlockDesc')}</span>
              {' '}
              <a href="https://blog.fastthread.io/" target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>{t('detectionRefLink')}</a>
            </div>
            <div>
              <Tag color="orange" style={{ fontSize: 12 }}>⚠ {t('finalizerTrapTag')}</Tag>
              <span style={{ color: '#666' }}>{t('detectionRefFinalizerDesc')}</span>
              {' '}
              <a href="https://blog.fastthread.io/thread-dump-analysis-pattern-leprechaun-trap/" target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>{t('detectionRefLink')}</a>
            </div>
            <div>
              <Tag color="volcano" style={{ fontSize: 12 }}>⚠ {t('throwingExceptionTag')}</Tag>
              <span style={{ color: '#666' }}>{t('detectionRefExceptionDesc')}</span>
              {' '}
              <a href="https://blog.fastthread.io/threads-throwing-exception/" target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>{t('detectionRefLink')}</a>
            </div>
          </div>
        </div>
      }
      title={t('detectionRefPopoverTitle')}
      placement="topLeft"
    >
      <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer', marginLeft: 4 }} />
    </Popover>
  );

  const columns: ColumnsType<ThreadSummary> = [
    {
      title: <span>{t('threads.threadName')}{detectionRefPopover}</span>,
      dataIndex: 'name',
      key: 'name',
      width: 280,
      ellipsis: true,
      render: (name: string, record: ThreadSummary) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {record.inDeadlock && (
            <Tooltip title={t('deadlockTag')}>
              <BugOutlined style={{ color: '#ff4d4f', fontSize: 14 }} />
            </Tooltip>
          )}
          {record.finalizerTrapped && (
            <Tooltip title={t('finalizerTrapTag')}>
              <ExclamationCircleOutlined style={{ color: '#fa8c16', fontSize: 14 }} />
            </Tooltip>
          )}
          {record.throwingException && (
            <Tooltip title={t('throwingExceptionTag')}>
              <WarningOutlined style={{ color: '#f5222d', fontSize: 14 }} />
            </Tooltip>
          )}
          <Text code style={{ fontSize: 13 }}>
            {name}
          </Text>
        </span>
      ),
    },
    {
      title: t('threads.nid'),
      dataIndex: 'nid',
      key: 'nid',
      width: 100,
      render: (v: string | undefined) => (
        <Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 12 }}>
          {v || '-'}
        </Text>
      ),
    },
    {
      title: t('threads.state'),
      dataIndex: 'state',
      key: 'state',
      width: 140,
      render: (state: string, record: ThreadSummary) => {
        let tagColor = stateColorMap[state] || 'default';
        if (record.inDeadlock) tagColor = '#ff4d4f';
        else if (record.finalizerTrapped) tagColor = '#fa8c16';
        else if (record.throwingException) tagColor = '#cf1322';

        let suffix = '';
        if (record.inDeadlock || record.finalizerTrapped || record.throwingException) suffix = ' ⚠';

        return (
          <Tag color={tagColor} style={{ fontWeight: 600 }}>
            {state}{suffix}
          </Tag>
        );
      },
      filters: Array.from(new Set(threads.map((t) => t.state))).map((s) => ({
        text: s,
        value: s,
      })),
      onFilter: (value: React.Key | boolean, record: ThreadSummary) => record.state === value,
    },
    {
      title: t('threads.waitingLock'),
      dataIndex: 'waitingOnLock',
      key: 'waitingOnLock',
      width: 200,
      ellipsis: true,
      render: (v: string | undefined, record: ThreadSummary) =>
        v ? (
          <Text code style={{ fontSize: 12, fontFamily: 'monospace' }}>
            {v}
            {record.waitingOnLockClass ? ` (${record.waitingOnLockClass})` : ''}
          </Text>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: t('threads.stackDepth'),
      key: 'stackDepth',
      width: 90,
      render: (_: unknown, record: ThreadSummary) => record.stackTrace?.length ?? 0,
      sorter: (a: ThreadSummary, b: ThreadSummary) => (a.stackTrace?.length ?? 0) - (b.stackTrace?.length ?? 0),
    },
  ].filter((col) => {
    // 分享模式下隐藏栈深度列（加载前未知）
    if (reportId && col.key === 'stackDepth') return false;
    return true;
  });

  return (
    <Card
      title={
        <Title level={5} style={{ margin: 0 }}>
          {t('threads.filtered', { filtered: filtered.length, total: threads.length })}
        </Title>
      }
      extra={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Popover
            content={
              <div style={{ maxWidth: 420, fontSize: 13, lineHeight: 2 }}>
                <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>{t('threads.threadListHelp')}</div>
                <ul style={{ margin: '0 0 12px', paddingLeft: 18, color: '#555' }}>
                  <li>{t('threads.threadListHelpSearch')}</li>
                  <li>{t('threads.threadListHelpFilter')}</li>
                  <li>{t('threads.threadListHelpExpand')}</li>
                  <li>{t('threads.threadListHelpPage')}</li>
                </ul>

                <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13, paddingTop: 8, borderTop: '1px solid #f0f0f0' }}>
                  {t('threads.threadListHelpFilterTag')}
                </div>

                <div style={{ marginBottom: 8, color: '#555', paddingLeft: 4 }}>
                  <div style={{ marginBottom: 3 }}>{t('threads.threadListHelpDeadlock')}</div>
                  <div style={{ marginBottom: 3 }}>{t('threads.threadListHelpFinalizerTrap')}</div>
                  <div style={{ marginBottom: 3 }}>{t('threads.threadListHelpException')}</div>
                </div>

                <div style={{ marginBottom: 6, color: '#555', paddingLeft: 4 }}>
                  {t('threads.threadListHelpIconMeaning')}
                </div>

                <div style={{ fontWeight: 600, marginTop: 10, marginBottom: 6, fontSize: 13, paddingTop: 8, borderTop: '1px solid #f0f0f0' }}>
                  {t('threads.threadListHelpRefHeader')}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 4 }}>
                  <div>
                    <Tag color="red" style={{ fontSize: 11, margin: 0 }}>🐛 {t('deadlockTag')}</Tag>
                    <span style={{ color: '#666', marginLeft: 6 }}>{t('threads.threadListHelpRefDeadlock')}</span>
                  </div>
                  <div>
                    <a href="https://blog.fastthread.io/circular-deadlock/" target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#1890ff' }}>
                      → blog.fastthread.io/circular-deadlock/
                    </a>
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <Tag color="orange" style={{ fontSize: 11, margin: 0 }}>⚠ {t('finalizerTrapTag')}</Tag>
                    <span style={{ color: '#666', marginLeft: 6 }}>{t('threads.threadListHelpRefFinalizer')}</span>
                  </div>
                  <div>
                    <a href="https://blog.fastthread.io/thread-dump-analysis-pattern-leprechaun-trap/" target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#1890ff' }}>
                      → blog.fastthread.io/leprechaun-trap/
                    </a>
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <Tag color="volcano" style={{ fontSize: 11, margin: 0 }}>⚠ {t('throwingExceptionTag')}</Tag>
                    <span style={{ color: '#666', marginLeft: 6 }}>{t('threads.threadListHelpRefException')}</span>
                  </div>
                  <div>
                    <a href="https://blog.fastthread.io/threads-throwing-exception/" target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#1890ff' }}>
                      → blog.fastthread.io/threads-throwing-exception/
                    </a>
                  </div>
                </div>
              </div>
            }
            title={t('threads.threadListHelpTitle')} placement="topRight"
          >
            <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
          </Popover>
          <Input
            prefix={<SearchOutlined style={{ color: '#bbb' }} />}
            placeholder={t('threads.threadListSearchPlaceholder')}
            allowClear
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 220, fontSize: 13 }}
            size="small"
          />
        </div>
      }
    >
      {/* 检测摘要 Tag 行 */}
      {threads.some(t => t.inDeadlock || t.finalizerTrapped || t.throwingException) && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {!filterType && (
            <span style={{ fontSize: 12, color: '#999', display: 'flex', alignItems: 'center', gap: 2 }}>
              <InfoCircleOutlined /> {t('threads.clickTagHint')}
            </span>
          )}
          {threads.some(t => t.inDeadlock) && (
            <Tooltip title={t('threads.deadlockDetectedTip')}>
              <Tag
                color={filterType === 'deadlock' ? 'red' : undefined}
                style={{
                  fontSize: 12, padding: '2px 10px', borderRadius: 10,
                  cursor: 'pointer',
                  border: filterType === 'deadlock' ? '2px solid #ff4d4f' : '1px solid #ffa39e',
                  background: filterType === 'deadlock' ? '#ff4d4f' : '#fff1f0',
                  color: filterType === 'deadlock' ? '#fff' : '#cf1322',
                }}
                onClick={() => setFilterType(prev => prev === 'deadlock' ? null : 'deadlock')}
              >
                <BugOutlined /> {t('result.deadlockCount', { count: deadlockCount ?? 0 })}
              </Tag>
            </Tooltip>
          )}
          {threads.some(t => t.finalizerTrapped) && (
            <Tooltip title={t('threads.finalizerTrapDetectedTip')}>
              <Tag
                style={{
                  fontSize: 12, padding: '2px 10px', borderRadius: 10,
                  cursor: 'pointer',
                  border: filterType === 'finalizerTrap' ? '2px solid #fa8c16' : '1px solid #ffd591',
                  background: filterType === 'finalizerTrap' ? '#fa8c16' : '#fff7e6',
                  color: filterType === 'finalizerTrap' ? '#fff' : '#ad2102',
                }}
                onClick={() => setFilterType(prev => prev === 'finalizerTrap' ? null : 'finalizerTrap')}
              >
                <ExclamationCircleOutlined /> {t('threads.finalizerTrapTagShort')}: {threads.filter(t => t.finalizerTrapped).length}
              </Tag>
            </Tooltip>
          )}
          {threads.some(t => t.throwingException) && (
            <Tooltip title={t('threads.exceptionDetectedTip')}>
              <Tag
                style={{
                  fontSize: 12, padding: '2px 10px', borderRadius: 10,
                  cursor: 'pointer',
                  border: filterType === 'throwingException' ? '2px solid #ff4d4f' : '1px solid #ffccc7',
                  background: filterType === 'throwingException' ? '#ff4d4f' : '#fff1f0',
                  color: filterType === 'throwingException' ? '#fff' : '#cf1322',
                }}
                onClick={() => setFilterType(prev => prev === 'throwingException' ? null : 'throwingException')}
              >
                <WarningOutlined /> {t('threads.exceptionTagShort')}: {threads.filter(t => t.throwingException).length}
              </Tag>
            </Tooltip>
          )}
          {filterType && (
            <span
              style={{ fontSize: 12, color: '#999', cursor: 'pointer', marginLeft: 4 }}
              onClick={() => setFilterType(null)}
            >
              {t('threads.clearFilter')}
            </span>
          )}
        </div>
      )}
      <Table<ThreadSummary>
        dataSource={filtered}
        columns={columns}
        rowKey={(record, index) => record.nid || `${record.name}-${index}`}
        pagination={{
          defaultPageSize: 20,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (total) => t('threads.totalItems', { total }),
        }}
        expandable={{
          expandedRowRender: (record) => {
            // 分享模式：按需加载调用栈
            if (reportId && !record.stackTrace?.length) {
              return <LazyStackTrace threadsIdx={threadsIdx!} bucketCache={bucketCache!} loadBucket={loadBucket!} tid={record.tid!} />;
            }
            // 传统模式：直接渲染调用栈
            const rawLines = buildRawStackLines(record);
            return (
              <div style={{ padding: '4px 0' }}>
                <Text strong style={{ fontSize: 13 }}>
                  {t('threads.stackTrace')}（{t('threads.stackFrameCount', { count: record.stackTrace?.length ?? 0 })}）
                </Text>
                <pre
                  style={{
                    background: '#1e1e1e',
                    color: '#d4d4d4',
                    padding: 16,
                    borderRadius: 8,
                    fontSize: 12,
                    lineHeight: 1.8,
                    maxHeight: 400,
                    overflow: 'auto',
                    fontFamily: "'Fira Code', 'Consolas', 'Courier New', monospace",
                  }}
                >
                  {rawLines.map((line, i) => {
                    const isAtLine = line.startsWith('at ');
                    const isWaitingLine = line.startsWith('- waiting to lock') || line.startsWith('- parking to wait');
                    const isLockedLine = line.startsWith('- locked');
                    let color = '#d4d4d4';
                    if (isAtLine) color = '#dcdcaa';
                    else if (isLockedLine) color = '#569cd6';
                    else if (isWaitingLine) color = '#ce9178';
                    return (
                      <div key={i} style={{ color }}>
                        {line}
                      </div>
                    );
                  })}
                </pre>
              </div>
            );
          },
          rowExpandable: (record) => reportId ? !!record.tid : (record.stackTrace?.length ?? 0) > 0,
        }}
        size="middle"
        scroll={{ x: 800 }}
        locale={{
          emptyText: <Empty description={t('threads.noMatchingThreads')} />,
        }}
        rowClassName={(record) => {
          if (record.inDeadlock) return 'deadlock-row';
          if (record.finalizerTrapped) return 'finalizer-trap-row';
          if (record.throwingException) return 'exception-row';
          return '';
        }}
      />

      <style>{`
        .deadlock-row {
          background: #fff2f0 !important;
        }
        .deadlock-row:hover td {
          background: #ffe7e3 !important;
        }
        .finalizer-trap-row {
          background: #fff7e6 !important;
        }
        .finalizer-trap-row:hover td {
          background: #ffe7ba !important;
        }
        .exception-row {
          background: #fff1f0 !important;
        }
        .exception-row:hover td {
          background: #ffccc7 !important;
        }
      `}</style>
    </Card>
  );
};

// ========== 导出主组件 ==========

interface ThreadsProps {
  threads: ThreadSummary[];
  view?: 'list' | 'groups';
  deadlockCount?: number;
  reportId?: string;
  threadsIdx?: Record<number, number> | null;
  bucketCache?: Map<number, ThreadSummary[]>;
  loadBucket?: (bucket: number) => void;
  stackGroups?: StackGroupVO[] | null;
}

const Threads: React.FC<ThreadsProps> = ({ threads, view = 'list', deadlockCount, reportId, threadsIdx, bucketCache, loadBucket, stackGroups }) => {
  return (
    <div>
      {view === 'groups' && <StackGroupAnalysis threads={threads} stackGroups={stackGroups} />}
      {view === 'list' && <ThreadList threads={threads} deadlockCount={deadlockCount} reportId={reportId} threadsIdx={threadsIdx} bucketCache={bucketCache} loadBucket={loadBucket} />}
    </div>
  );
};

export default Threads;
