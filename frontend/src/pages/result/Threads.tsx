import React, { useMemo, useState } from 'react';
import { Card, Table, Tag, Typography, Empty, Popover, Modal, Input, message } from 'antd';
import { SearchOutlined, BugOutlined, QuestionCircleOutlined, CopyOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { ThreadSummary } from '../../types';

const { Title, Text, Paragraph } = Typography;

// ========== 类型 ==========

/** 相同堆栈分组 */
interface StackGroup {
  key: string;           // stackTrace.join 后的唯一 key
  count: number;          // 该组线程数
  sampleThread: ThreadSummary;
  allThreads: ThreadSummary[];
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

/** 使用说明 */
const HELP_CONTENT = (
  <div style={{ maxWidth: 400 }}>
    <p style={{ margin: '0 0 8px' }}>
      <strong>相同堆栈分析</strong>（RSI 模式）帮助快速定位线程堆积瓶颈。
    </p>
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      <li><strong>原理</strong>：大量线程拥有相同调用栈 = 同一瓶颈点堆积（参考 fastThread RSI 模式）</li>
      <li><strong>代表栈帧</strong>：取该组第一、第二栈帧作为标识，点击行可查看完整栈</li>
      <li><strong>搜索</strong>：输入包名/方法名，过滤包含该关键词的堆栈组</li>
      <li><strong>排序</strong>：默认按线程数降序，线程数越多越可能是瓶颈</li>
    </ul>
    <p style={{ margin: '8px 0 0', color: '#999', fontSize: 12 }}>
      严重 RSI：线程数 &gt; 总线程 30% 且处于 BLOCKED/WAITING 状态，大概率存在锁竞争或外部依赖阻塞。
    </p>
  </div>
);

/** 线程列表使用说明 */
const THREAD_HELP = (
  <div style={{ maxWidth: 380 }}>
    <p style={{ margin: '0 0 8px' }}>
      <strong>线程列表</strong>展示转储中所有线程的详细信息。
    </p>
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      <li><strong>搜索</strong>：支持按线程名、状态、栈帧内容过滤</li>
      <li><strong>状态过滤</strong>：点击「状态」列标题的漏斗图标筛选</li>
      <li><strong>展开行</strong>：点击行左侧展开按钮查看完整调用栈</li>
      <li><strong>分页</strong>：支持切换每页显示 10/20/50/100 条</li>
    </ul>
    <p style={{ margin: '8px 0 0', color: '#999' }}>
      红色行 = 参与死锁的线程，⚠ 标记 = BLOCKED 且处于死锁环中。
    </p>
  </div>
);

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
const StackGroupAnalysis: React.FC<{ threads: ThreadSummary[] }> = ({ threads }) => {
  const [searchText, setSearchText] = useState('');
  const [modalGroup, setModalGroup] = useState<StackGroup | null>(null);

  // 按完整堆栈分组
  const groups = useMemo<StackGroup[]>(() => {
    const map = new Map<string, ThreadSummary[]>();
    threads.forEach((t) => {
      const key = t.stackTrace.join('\x00');
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
        firstFrame: arr[0].stackTrace[0] || '(无栈帧)',
        secondFrame: arr[0].stackTrace[1] || '',
        states,
      });
    });
    // 按线程数降序
    result.sort((a, b) => b.count - a.count);
    return result;
  }, [threads]);

  // 搜索过滤
  const filteredGroups = useMemo(() => {
    if (!searchText) return groups;
    const kw = searchText.toLowerCase();
    return groups.filter((g) =>
      g.firstFrame.toLowerCase().includes(kw) ||
      g.secondFrame.toLowerCase().includes(kw) ||
      g.sampleThread.name.toLowerCase().includes(kw) ||
      g.allThreads.some((t) => t.name.toLowerCase().includes(kw)) ||
      g.sampleThread.stackTrace.some((f) => f.toLowerCase().includes(kw))
    );
  }, [groups, searchText]);

  const totalGroups = groups.length;
  const topGroup = groups[0];
  const topGroupPct = topGroup ? ((topGroup.count / threads.length) * 100).toFixed(1) : '0';

  const columns: ColumnsType<StackGroup> = [
    {
      title: '线程数',
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
          代表栈帧 <span style={{ fontSize: 11, color: '#999', fontWeight: 400 }}>点击查看详情</span>
        </span>
      ),
      key: 'frames',
      ellipsis: true,
      render: (_: unknown, g: StackGroup) => (
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
      title: '状态',
      key: 'states',
      width: 140,
      render: (_: unknown, g: StackGroup) => (
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
      title: '线程名',
      key: 'names',
      ellipsis: true,
      render: (_: unknown, g: StackGroup) => (
        <span style={{ fontSize: 12, color: '#666' }}>
          {g.allThreads
            .slice(0, 3)
            .map((t) => t.name)
            .join('、')}
          {g.allThreads.length > 3 && ` 等 ${g.allThreads.length} 个`}
        </span>
      ),
    },
  ];

  return (
    <Card
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Title level={5} style={{ margin: 0 }}>
            相同堆栈分析
          </Title>
          <Tag color={parseFloat(topGroupPct) > 30 ? 'red' : 'blue'} style={{ fontSize: 11, margin: 0 }}>
            {totalGroups} 组 &nbsp;|&nbsp; 最大组 {topGroup?.count || 0} 线程（{topGroupPct}%）
          </Tag>
        </span>
      }
      extra={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Popover content={HELP_CONTENT} title="使用说明（RSI 模式）" placement="topRight">
            <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
          </Popover>
          <Input
            prefix={<SearchOutlined style={{ color: '#bbb' }} />}
            placeholder="搜索包名/方法名，过滤堆栈组..."
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
      {filteredGroups.length === 0 ? (
        <Empty description="无匹配的堆栈组" style={{ padding: 20 }} />
      ) : (
        <Table<StackGroup>
          dataSource={filteredGroups}
          columns={columns}
          rowKey="key"
          size="middle"
          pagination={{
            defaultPageSize: 10,
            showSizeChanger: true,
            pageSizeOptions: [10, 15, 20, 50],
            showTotal: (total) => `共 ${total} 个堆栈组`,
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
        title={
          <span style={{ fontSize: 15 }}>
            堆栈组详情 — <span style={{ color: '#1890ff' }}>{modalGroup?.count} 个线程</span>
          </span>
        }
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
                  {s}: {c} 线程
                </Tag>
              ))}
            </div>

            {/* 锁信息（独立展示，仅在原始栈中已有时不重复显示） */}

            {/* 完整调用栈（原始 jstack 格式） */}
            <div style={{ marginBottom: 12 }}>
              <Text strong style={{ fontSize: 13, marginBottom: 6, display: 'block' }}>
                完整调用栈
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
                <Text strong style={{ fontSize: 13 }}>该组线程名（{modalGroup.allThreads.length} 个）</Text>
                <span
                  onClick={() => {
                    const text = modalGroup.allThreads.map((t) => t.name).join('\n');
                    navigator.clipboard?.writeText(text).then(() => {
                      message.success('线程名已复制到剪贴板');
                    }).catch(() => message.error('复制失败'));
                  }}
                  style={{ cursor: 'pointer', fontSize: 12, color: '#1890ff' }}
                >
                  <CopyOutlined /> 复制全部
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
                {modalGroup.allThreads.map((t, i) => (
                  <div key={i} style={{ padding: '2px 0' }}>
                    {t.name}
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

// ========== 线程列表（原样保留） ==========

const ThreadList: React.FC<{ threads: ThreadSummary[] }> = ({ threads }) => {
  const [searchText, setSearchText] = useState('');

  const filtered = searchText
    ? threads.filter(
        (t) =>
          t.name.toLowerCase().includes(searchText.toLowerCase()) ||
          t.state.toLowerCase().includes(searchText.toLowerCase()) ||
          t.stackTrace.some((f) =>
            f.toLowerCase().includes(searchText.toLowerCase())
          )
      )
    : threads;

  const columns: ColumnsType<ThreadSummary> = [
    {
      title: '线程名',
      dataIndex: 'name',
      key: 'name',
      width: 280,
      ellipsis: true,
      render: (name: string, record) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {record.inDeadlock && <BugOutlined style={{ color: '#ff4d4f' }} />}
          <Text code style={{ fontSize: 13 }}>
            {name}
          </Text>
        </span>
      ),
    },
    {
      title: 'NID',
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
      title: '状态',
      dataIndex: 'state',
      key: 'state',
      width: 140,
      render: (state: string, record) => (
        <Tag
          color={record.inDeadlock ? '#ff4d4f' : (stateColorMap[state] || 'default')}
          style={{ fontWeight: 600 }}
        >
          {state}
          {record.inDeadlock && ' ⚠'}
        </Tag>
      ),
      filters: Array.from(new Set(threads.map((t) => t.state))).map((s) => ({
        text: s,
        value: s,
      })),
      onFilter: (value, record) => record.state === value,
    },
    {
      title: '等待锁',
      dataIndex: 'waitingOnLock',
      key: 'waitingOnLock',
      width: 200,
      ellipsis: true,
      render: (v: string | undefined, record) =>
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
      title: '栈深度',
      key: 'stackDepth',
      width: 90,
      render: (_: unknown, record) => record.stackTrace.length,
      sorter: (a, b) => a.stackTrace.length - b.stackTrace.length,
    },
  ];

  return (
    <Card
      title={
        <Title level={5} style={{ margin: 0 }}>
          线程列表（{filtered.length} / {threads.length}）
        </Title>
      }
      extra={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Popover content={THREAD_HELP} title="使用说明" placement="topRight">
            <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
          </Popover>
          <Input
            prefix={<SearchOutlined style={{ color: '#bbb' }} />}
            placeholder="搜索线程名/状态/栈帧..."
            allowClear
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 220, fontSize: 13 }}
            size="small"
          />
        </div>
      }
    >
      <Table<ThreadSummary>
        dataSource={filtered}
        columns={columns}
        rowKey={(record, index) => record.nid || `${record.name}-${index}`}
        pagination={{
          defaultPageSize: 20,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (total) => `共 ${total} 条`,
        }}
        expandable={{
          expandedRowRender: (record) => {
            const rawLines = buildRawStackLines(record);
            return (
              <div style={{ padding: '4px 0' }}>
                <Text strong style={{ fontSize: 13 }}>
                  调用栈（{record.stackTrace.length} 帧）
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
          rowExpandable: (record) => record.stackTrace.length > 0,
        }}
        size="middle"
        scroll={{ x: 800 }}
        locale={{
          emptyText: <Empty description="无匹配的线程" />,
        }}
        rowClassName={(record) =>
          record.inDeadlock ? 'deadlock-row' : ''
        }
      />

      <style>{`
        .deadlock-row {
          background: #fff2f0 !important;
        }
        .deadlock-row:hover td {
          background: #ffe7e3 !important;
        }
      `}</style>
    </Card>
  );
};

// ========== 导出主组件 ==========

interface ThreadsProps {
  threads: ThreadSummary[];
  view?: 'list' | 'groups';
}

const Threads: React.FC<ThreadsProps> = ({ threads, view = 'list' }) => {
  return (
    <div>
      {view === 'groups' && <StackGroupAnalysis threads={threads} />}
      {view === 'list' && <ThreadList threads={threads} />}
    </div>
  );
};

export default Threads;
