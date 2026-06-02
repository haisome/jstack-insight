import React, { useMemo } from 'react';
import { Card, Typography, Tooltip, Table, Popover } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { QuestionCircleOutlined } from '@ant-design/icons';
import type { ThreadStateVO } from '../../types';

const { Title } = Typography;

interface ThreadGroupsProps {
  threadState: ThreadStateVO;
}

/** 线程状态颜色映射 */
const STATE_COLOR_MAP: Record<string, string> = {
  RUNNABLE: '#1890ff',
  BLOCKED: '#ff4d4f',
  WAITING: '#faad14',
  TIMED_WAITING: '#13c2c2',
  TERMINATED: '#8c8c8c',
  NEW: '#52c41a',
  UNKNOWN: '#bfbfbf',
};

/** 线程状态含义说明 */
const STATE_DESCRIPTION_MAP: Record<string, { label: string; desc: string }> = {
  RUNNABLE: { label: '运行中', desc: '正在 CPU 上执行或已准备好运行，等待 CPU 时间片' },
  BLOCKED: { label: '阻塞', desc: '等待获取监视器锁（synchronized），被其他线程持有' },
  WAITING: { label: '等待', desc: '无限期等待（Object.wait()、LockSupport.park()），需要被其他线程唤醒' },
  TIMED_WAITING: { label: '限时等待', desc: '限时等待（Thread.sleep()、Object.wait(timeout)），超时后自动唤醒' },
  TERMINATED: { label: '已终止', desc: '线程执行完毕退出' },
  NEW: { label: '新建', desc: '已创建但尚未调用 start()' },
  UNKNOWN: { label: '未知', desc: '无法识别的线程状态' },
};

/** 线程组名称配色 */
const GROUP_COLORS = [
  '#1677ff', '#722ed1', '#13c2c2', '#eb2f96', '#fa8c16',
  '#52c41a', '#f5222d', '#2f54eb', '#faad14', '#1890ff',
  '#a0d911', '#9254de', '#597ef7', '#ff7a45', '#36cfc9',
];

/** 线程组分组逻辑说明 */
const THREAD_GROUP_HELP = (
  <div style={{ maxWidth: 480, fontSize: 13 }}>
    <p style={{ margin: '0 0 8px', fontWeight: 600 }}>线程组分组逻辑</p>
    <p style={{ margin: '0 0 8px', color: '#666' }}>
      从线程名中提取「组名」，将同类线程归为一组，便于快速识别线程池、连接器等组件。
    </p>
    <p style={{ margin: '0 0 4px', fontWeight: 500 }}>提取规则（按顺序执行）：</p>
    <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
      <li>去掉末尾 <code>#数字</code> 后缀（如 <code>thread#5</code> → <code>thread</code>）</li>
      <li>去掉末尾 <code>-数字</code> 后缀（如 <code>pool-1-thread-3</code> → <code>pool-1</code>）</li>
      <li>若结果为空则保留原线程名</li>
    </ol>
    <p style={{ margin: '8px 0 0', color: '#999', fontSize: 12 }}>
      示例：<code>elasticsearch[search][T#567]</code> → <code>elasticsearch[search][T]</code> → 归入同一组
    </p>
  </div>
);

function extractThreadGroup(name: string): string {
  let group = name.replace(/#\d+$/, '');
  group = group.replace(/-\d+$/, '');
  return group || name;
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

interface ThreadGroupInfo {
  groupName: string;
  threadCount: number;
  states: Record<string, number>;
  members: string[];
}

const ThreadGroups: React.FC<ThreadGroupsProps> = ({ threadState }) => {
  const { threads } = threadState;

  // ========== 线程组分组 ==========
  const threadGroups = useMemo((): ThreadGroupInfo[] => {
    const groupMap = new Map<string, ThreadGroupInfo>();

    for (const t of threads) {
      const groupName = extractThreadGroup(t.name);
      let info = groupMap.get(groupName);
      if (!info) {
        info = { groupName, threadCount: 0, states: {}, members: [] };
        groupMap.set(groupName, info);
      }
      info.threadCount++;
      info.states[t.state] = (info.states[t.state] || 0) + 1;
      info.members.push(t.name);
    }

    return Array.from(groupMap.values()).sort((a, b) => b.threadCount - a.threadCount);
  }, [threads]);

  const allStatesInGroups = useMemo(() => {
    const stateSet = new Set<string>();
    threadGroups.forEach((g) => Object.keys(g.states).forEach((s) => stateSet.add(s)));
    const order = ['RUNNABLE', 'BLOCKED', 'WAITING', 'TIMED_WAITING', 'TERMINATED', 'NEW', 'UNKNOWN'];
    return order.filter((s) => stateSet.has(s));
  }, [threadGroups]);

  // ========== 线程组表格列 ==========
  const groupColumns: ColumnsType<ThreadGroupInfo> = [
    {
      title: '线程组',
      dataIndex: 'groupName',
      key: 'groupName',
      width: 280,
      render: (name: string) => {
        const color = GROUP_COLORS[hashCode(name) % GROUP_COLORS.length];
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                display: 'inline-block',
                width: 6,
                height: 24,
                borderRadius: 3,
                background: color,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: 'Menlo, Monaco, Consolas, monospace',
                fontSize: 12,
                fontWeight: 500,
                maxWidth: 240,
                display: 'inline-block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: color,
              }}
              title={name}
            >
              {name}
            </span>
          </div>
        );
      },
    },
    {
      title: '线程数',
      dataIndex: 'threadCount',
      key: 'threadCount',
      width: 90,
      align: 'center',
      sorter: (a, b) => a.threadCount - b.threadCount,
      defaultSortOrder: 'descend',
      render: (count: number) => (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 36,
            height: 24,
            borderRadius: 12,
            fontWeight: 700,
            fontSize: 13,
            color: '#fff',
            background: count > 50 ? '#f5222d' : count > 20 ? '#fa8c16' : count > 5 ? '#1677ff' : '#52c41a',
          }}
        >
          {count}
        </span>
      ),
    },
    ...allStatesInGroups.map((state) => {
      const stateColor = STATE_COLOR_MAP[state] || '#bfbfbf';
      return {
        title: (
          <Tooltip
            title={STATE_DESCRIPTION_MAP[state]?.desc || ''}
            placement="top"
          >
            <span
              style={{
                cursor: 'help',
                color: stateColor,
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              {state}
            </span>
          </Tooltip>
        ),
        key: state,
        width: 110,
        align: 'center' as const,
        render: (_: unknown, record: ThreadGroupInfo) => {
          const count = record.states[state] || 0;
          const pct = record.threadCount > 0 ? ((count / record.threadCount) * 100).toFixed(0) : '0';
          return count > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: stateColor }}>{count}</span>
              <div style={{ width: 48, height: 4, borderRadius: 2, background: '#f0f0f0' }}>
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    borderRadius: 2,
                    background: stateColor,
                    minWidth: pct !== '0' ? 4 : 0,
                  }}
                />
              </div>
              <span style={{ fontSize: 10, color: '#999' }}>{pct}%</span>
            </div>
          ) : (
            <span style={{ color: '#e8e8e8' }}>-</span>
          );
        },
      };
    }),
  ];

  return (
    <div>
      <Card
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Title level={5} style={{ margin: 0 }}>线程组</Title>
            <Popover content={THREAD_GROUP_HELP} title="分组逻辑" placement="topLeft" trigger="hover">
              <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer', fontSize: 14 }} />
            </Popover>
          </span>
        }
      >
        {threadGroups.length > 0 ? (
          <Table<ThreadGroupInfo>
            columns={groupColumns}
            dataSource={threadGroups}
            rowKey="groupName"
            size="middle"
            pagination={{
              defaultPageSize: 15,
              showSizeChanger: true,
              pageSizeOptions: [10, 15, 20, 50],
              showTotal: (total) => `共 ${total} 组`,
              size: 'small',
            }}
            scroll={{ x: 800 }}
          />
        ) : (
          <div style={{ textAlign: 'center', color: '#999', padding: '40px 0' }}>
            暂无线程数据
          </div>
        )}
      </Card>
    </div>
  );
};

export default ThreadGroups;
