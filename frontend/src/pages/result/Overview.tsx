import React, { useMemo } from 'react';
import { Card, Row, Col, Statistic, Typography, Alert, Tooltip } from 'antd';
import {
  TeamOutlined,
  BugOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { Pie } from '@ant-design/charts';
import type { ThreadStateVO as ThreadStateVOType } from '../../types';

const { Title } = Typography;

interface OverviewProps {
  threadState: ThreadStateVOType;
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
  RUNNABLE: {
    label: '运行中',
    desc: '正在 CPU 上执行或已准备好运行，等待 CPU 时间片',
  },
  BLOCKED: {
    label: '阻塞',
    desc: '等待获取监视器锁（synchronized），被其他线程持有',
  },
  WAITING: {
    label: '等待',
    desc: '无限期等待（Object.wait()、LockSupport.park()），需要被其他线程唤醒',
  },
  TIMED_WAITING: {
    label: '限时等待',
    desc: '限时等待（Thread.sleep()、Object.wait(timeout)），超时后自动唤醒',
  },
  TERMINATED: {
    label: '已终止',
    desc: '线程执行完毕退出',
  },
  NEW: {
    label: '新建',
    desc: '已创建但尚未调用 start()',
  },
  UNKNOWN: {
    label: '未知',
    desc: '无法识别的线程状态',
  },
};

interface OverviewProps {
  threadState: ThreadStateVOType;
}

const Overview: React.FC<OverviewProps> = ({ threadState }) => {
  const { totalThreads, stateCounts, deadlockCount } = threadState;

  // ========== 活跃状态（按数量降序） ==========
  const activeStates = useMemo(() =>
    Object.entries(stateCounts)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a),
    [stateCounts],
  );

  // ========== 饼图数据 ==========
  const pieData = useMemo(() =>
    activeStates.map(([state, count]) => ({
      type: state,
      value: count,
      color: STATE_COLOR_MAP[state] || '#bfbfbf',
    })),
    [activeStates],
  );

  const pieConfig = {
    data: pieData,
    angleField: 'value',
    colorField: 'type',
    color: pieData.map((d) => d.color),
    radius: 0.75,
    innerRadius: 0.55,
    legend: false,
    label: {
      text: (d: { type: string; value: number }) => {
        const pct = totalThreads > 0 ? ((d.value / totalThreads) * 100).toFixed(1) : '0.0';
        return `${d.type}: ${pct}%`;
      },
      position: 'outside' as const,
      style: { fontSize: 11 },
    },
    tooltip: {
      title: false,
      items: [
        (datum: any) => {
          const info = STATE_DESCRIPTION_MAP[datum.type];
          const pct = totalThreads > 0 ? ((datum.value / totalThreads) * 100).toFixed(1) : '0.0';
          return {
            name: `${datum.type}（${info?.label || ''}）`,
            value: `${datum.value} 个（${pct}%）`,
            color: datum.color,
          };
        },
      ],
    },
  };

  return (
    <div>
      {/* 指标卡 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card bodyStyle={{ minHeight: 78 }}>
            <Statistic
              title="线程总数"
              value={totalThreads}
              prefix={<TeamOutlined />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bodyStyle={{ minHeight: 78 }}>
            <Statistic
              title="死锁数量"
              value={deadlockCount}
              prefix={<BugOutlined />}
              valueStyle={{ color: deadlockCount > 0 ? '#ff4d4f' : '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bodyStyle={{ minHeight: 78 }}>
            <Statistic
              title="阻塞/等待线程"
              value={(stateCounts.BLOCKED || 0) + (stateCounts.WAITING || 0)}
              prefix={<WarningOutlined />}
              valueStyle={{ color: ((stateCounts.BLOCKED || 0) + (stateCounts.WAITING || 0)) > 0 ? '#faad14' : '#52c41a' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 死锁警告 */}
      {deadlockCount > 0 && (
        <Alert
          type="error"
          showIcon
          message={`检测到 ${deadlockCount} 个线程参与死锁！`}
          description="请立即查看「线程列表」中标记为红色的线程，可使用「锁竞争图」和 「死锁检测」 查看锁详情。"
          style={{ marginBottom: 24, borderRadius: 8 }}
        />
      )}

      {/* 线程状态分布：左侧自定义图例 + 右侧饼图 */}
      <Card
        title={
          <Title level={5} style={{ margin: 0 }}>
            线程状态分布
          </Title>
        }
        style={{ marginBottom: 24 }}
      >
        {activeStates.length > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            {/* 左侧：自定义图例 */}
            <div style={{ flexShrink: 0, width: 210 }}>
              {activeStates.map(([state, count]) => {
                const info = STATE_DESCRIPTION_MAP[state];
                const color = STATE_COLOR_MAP[state] || '#bfbfbf';
                const pct = totalThreads > 0 ? ((count / totalThreads) * 100).toFixed(1) : '0.0';
                return (
                  <Tooltip
                    key={state}
                    title={
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>
                          {state}（{info?.label || ''}）
                        </div>
                        <div style={{ fontSize: 12, color: '#d9d9d9' }}>{info?.desc || ''}</div>
                      </div>
                    }
                    placement="right"
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 10px',
                        borderRadius: 6,
                        cursor: 'default',
                        transition: 'background 0.2s',
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#f5f5f5'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      <span
                        style={{
                          display: 'inline-block',
                          width: 10,
                          height: 10,
                          borderRadius: 2,
                          background: color,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>{state}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 12, color: '#999', whiteSpace: 'nowrap' }}>
                        {count}
                        <span style={{ marginLeft: 2, fontSize: 11 }}>（{pct}%）</span>
                      </span>
                    </div>
                  </Tooltip>
                );
              })}
            </div>

            {/* 右侧：饼图 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <Pie {...pieConfig} />
            </div>
          </div>
        ) : (
          <div
            style={{
              height: 200,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#999',
            }}
          >
            暂无数据
          </div>
        )}
      </Card>

    </div>
  );
};

export default Overview;
