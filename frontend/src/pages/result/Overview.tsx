import React, { useMemo } from 'react';
import { Card, Row, Col, Statistic, Typography, Alert, Tooltip } from 'antd';
import {
  TeamOutlined,
  BugOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { Pie } from '@ant-design/charts';
import { useTranslation } from 'react-i18next';
import type { ThreadStateVO as ThreadStateVOType } from '../../types';

const { Title } = Typography;

interface OverviewProps {
  threadState: ThreadStateVOType;
}

const Overview: React.FC<OverviewProps> = ({ threadState }) => {
  const { t } = useTranslation();
  const { totalThreads, stateCounts, deadlockCount } = threadState;

  // ========== 线程状态颜色映射（不变） ==========
  const STATE_COLOR_MAP: Record<string, string> = useMemo(() => ({
    RUNNABLE: '#1890ff',
    BLOCKED: '#ff4d4f',
    WAITING: '#faad14',
    TIMED_WAITING: '#13c2c2',
    TERMINATED: '#8c8c8c',
    NEW: '#52c41a',
    UNKNOWN: '#bfbfbf',
  }), []);

  // ========== 线程状态含义说明（国际化） ==========
  const getStateDescriptionMap = (): Record<string, { label: string; desc: string }> => ({
    RUNNABLE: {
      label: t('overview.stateRunnable'),
      desc: t('overview.stateRunnableDesc'),
    },
    BLOCKED: {
      label: t('overview.stateBlocked'),
      desc: t('overview.stateBlockedDesc'),
    },
    WAITING: {
      label: t('overview.stateWaiting'),
      desc: t('overview.stateWaitingDesc'),
    },
    TIMED_WAITING: {
      label: t('overview.stateTimedWaiting'),
      desc: t('overview.stateTimedWaitingDesc'),
    },
    TERMINATED: {
      label: t('overview.stateTerminated'),
      desc: t('overview.stateTerminatedDesc'),
    },
    NEW: {
      label: t('overview.stateNew'),
      desc: t('overview.stateNewDesc'),
    },
    UNKNOWN: {
      label: t('overview.stateUnknown'),
      desc: t('overview.stateUnknownDesc'),
    },
  });

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
    [activeStates, STATE_COLOR_MAP],
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
          const stateDescMap = getStateDescriptionMap();
          const info = stateDescMap[datum.type];
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
              title={t('overview.statTotalThreads')}
              value={totalThreads}
              prefix={<TeamOutlined />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bodyStyle={{ minHeight: 78 }}>
            <Statistic
              title={t('overview.statDeadlockCount')}
              value={deadlockCount}
              prefix={<BugOutlined />}
              valueStyle={{ color: deadlockCount > 0 ? '#ff4d4f' : '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bodyStyle={{ minHeight: 78 }}>
            <Statistic
              title={t('overview.statBlockedWaiting')}
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
          message={t('overview.alertDeadlock', { count: deadlockCount })}
          description={t('overview.alertDeadlockDesc')}
          style={{ marginBottom: 24, borderRadius: 8 }}
        />
      )}

      {/* 线程状态分布：左侧自定义图例 + 右侧饼图 */}
      <Card
        title={
          <Title level={5} style={{ margin: 0 }}>
            {t('overview.title')}
          </Title>
        }
        style={{ marginBottom: 24 }}
      >
        {activeStates.length > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            {/* 左侧：自定义图例 */}
            <div style={{ flexShrink: 0, width: 210 }}>
              {activeStates.map(([state, count]) => {
                const stateDescMap = getStateDescriptionMap();
                const info = stateDescMap[state];
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
            {t('overview.noData')}
          </div>
        )}
      </Card>

    </div>
  );
};

export default Overview;
