import React, { useMemo, useState } from 'react';
import { Card, Typography, Table, Tag, Alert, Popover, Tooltip, Empty, Upload, Button, App, Spin, Progress, Modal } from 'antd';
import {
  QuestionCircleOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  FireOutlined,
  InfoCircleOutlined,
  UploadOutlined,
  ThunderboltOutlined,
  BugOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { UploadFile, UploadProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ThreadSummary, TopCpuVO, TopCpuThreadInfo } from '../../types';
import { uploadTopForCpu } from '../../services/api';

const { Title, Text } = Typography;

interface CpuAnalysisProps {
  threads: ThreadSummary[];
  /** jstack 原始文件对象（用于精准 CPU 关联时重新上传） */
  jstackRawFile?: File | null;
  /** 精准 CPU 分析结果（由 ResultPage 提升状态） */
  cpuTopResult: TopCpuVO | null;
  setCpuTopResult: (v: TopCpuVO | null) => void;
  /** 精准 CPU 分析的 top 文件列表（由 ResultPage 提升状态） */
  cpuTopFileList: UploadFile[];
  setCpuTopFileList: (v: UploadFile[]) => void;
  /** 视图模式：inference=CPU线程推测，precise=精准CPU采集 */
  view?: 'inference' | 'precise';
}

// ========== 栈跟踪还原辅助（复用 Threads.tsx 的 buildRawStackLines） ==========

/**
 * 还原原始 jstack 格式的调用栈行（含锁信息穿插）
 * 例如：
 *   at sun.misc.Unsafe.park(Native Method)
 *   - parking to wait for  <0x00000006e9355388> (a java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject)
 *   at java.util.concurrent.locks.LockSupport.park(LockSupport.java:175)
 */
function buildRawStackLines(thread: ThreadSummary): string[] {
  const lines: string[] = [];
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

// ========== 已知的 Native I/O 等待方法（伪装 RUNNABLE） ==========
const IO_WAIT_NATIVE_PATTERNS: RegExp[] = [
  /socketRead0/i,
  /socketWrite0/i,
  /socketAccept/i,
  /receive0/i,
  /send0/i,
  /epollWait/i,
  /poll0/i,
  /pollOne/i,
  /waitForSignal/i,
  /socketConnect/i,
  /read0/i,
  /write0/i,
  /available/i,
  /InputStream\.read/i,
  /FileChannelImpl\.read/i,
  /FileChannelImpl\.write/i,
];

// ========== 已知的 GC / 系统级 Native RUNNABLE（不一定是业务 CPU） ==========
const GC_NATIVE_PATTERNS: RegExp[] = [
  /GC\s/,
  /GC task/,
  /VM Thread/,
  /CompilerThread/,
  /ConcurrentGC/,
  /G1/i,
  /Paralle/i,
  /CMS/i,
  /ZGC/i,
  /Shenandoah/i,
];

/** 线程分类 */
type ThreadCategory = 'cpu_consuming' | 'io_wait' | 'gc';

interface CpuThreadResult {
  thread: ThreadSummary;
  /** 线程分类 */
  category: ThreadCategory;
  /** 评估理由 */
  reasons: string[];
  /** 栈深度 */
  stackDepth: number;
  /** 栈顶帧 */
  topFrame: string;
}

const CATEGORY_CONFIG: Record<ThreadCategory, {
  color: string;
  bg: string;
  tagColor: string;
  icon: React.ReactNode;
}> = {
  cpu_consuming: {
    color: '#ff4d4f',
    bg: '#fff2f0',
    tagColor: 'red',
    icon: <FireOutlined />,
  },
  io_wait: {
    color: '#8c8c8c',
    bg: '#fafafa',
    tagColor: 'default',
    icon: <CheckCircleOutlined />,
  },
  gc: {
    color: '#13c2c2',
    bg: '#e6fffb',
    tagColor: 'cyan',
    icon: <WarningOutlined />,
  },
};

/** 命令 demo */
const COMMAND_DEMO_TOP = 'top -H -p <pid> -n 1 -b > top_threads.txt';
const COMMAND_DEMO_JSTACK = 'jstack -l <pid> > jstack.txt';
const COMMAND_DEMO_COMBINED = COMMAND_DEMO_TOP + ' && ' + COMMAND_DEMO_JSTACK;

const PreciseCpuCollection: React.FC<{
  threads: ThreadSummary[];
  jstackRawFile?: File | null;
  topResult: TopCpuVO | null;
  setTopResult: (v: TopCpuVO | null) => void;
  topFileList: UploadFile[];
  setTopFileList: (v: UploadFile[]) => void;
}> = ({
  threads,
  jstackRawFile,
  topResult,
  setTopResult,
  topFileList,
  setTopFileList,
}) => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [selectedPreciseThread, setSelectedPreciseThread] = useState<{ topInfo: TopCpuThreadInfo; thread: ThreadSummary } | null>(null);

  // 构建 nid -> ThreadSummary 查找映射（用于点击线程名时关联完整栈信息）
  const threadByNid = useMemo(() => {
    const map = new Map<string, ThreadSummary>();
    threads.forEach((t) => {
      if (t.nid) map.set(t.nid, t);
    });
    return map;
  }, [threads]);

  const handleAnalyze = async () => {
    if (topFileList.length === 0) {
      message.warning(t('cpuAnalysis.warnNoFile'));
      return;
    }

    const topRawFile = topFileList[0].originFileObj;
    if (!topRawFile) {
      message.error(t('cpuAnalysis.errorFileObject'));
      return;
    }

    setLoading(true);
    try {
      const result = await uploadTopForCpu(jstackRawFile!, topRawFile);
      setTopResult(result);
      message.success(t('cpuAnalysis.successMatched', { count: result.matchedCount }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('cpuAnalysis.errorAnalyze');
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const topColumns: ColumnsType<TopCpuThreadInfo> = [
    {
      title: t('cpuAnalysis.cpuPercent'),
      dataIndex: 'cpuPercent',
      key: 'cpuPercent',
      width: 100,
      sorter: (a, b) => a.cpuPercent - b.cpuPercent,
      defaultSortOrder: 'descend',
      render: (pct: number) => {
        const color = pct > 50 ? '#ff4d4f' : pct > 20 ? '#fa8c16' : pct > 5 ? '#1677ff' : '#52c41a';
        return (
          <span style={{ fontWeight: 700, color, fontSize: 14 }}>
            {pct.toFixed(1)}%
          </span>
        );
      },
    },
    {
      title: t('cpuAnalysis.cpuPercentBar'),
      key: 'cpuBar',
      width: 150,
      render: (_: unknown, record: TopCpuThreadInfo) => {
        const total = topResult?.totalCpuPercent || 1;
        const pct = Math.min((record.cpuPercent / total) * 100, 100);
        const barColor = record.cpuPercent > 50 ? '#ff4d4f' : record.cpuPercent > 20 ? '#fa8c16' : '#1677ff';
        return (
          <Progress
            percent={parseFloat(pct.toFixed(1))}
            size="small"
            strokeColor={barColor}
            format={(p) => `${p}%`}
          />
        );
      },
    },
    {
      title: t('cpuAnalysis.threadNameCol'),
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name: string, record: TopCpuThreadInfo) => {
        const matched = threadByNid.get(record.nid);
        return (
          <Tooltip title={name}>
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontFamily: "'Menlo,Monaco,Consolas',monospace",
                fontSize: 12,
                cursor: matched ? 'pointer' : 'default',
                color: matched ? '#1677ff' : undefined,
              }}
              onClick={() => {
                if (matched) setSelectedPreciseThread({ topInfo: record, thread: matched });
              }}
            >
              {record.inDeadlock && <BugOutlined style={{ color: '#ff4d4f' }} />}
              {name}
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: t('cpuAnalysis.threadIdCol'),
      key: 'pid',
      width: 140,
      render: (_: unknown, record) => (
        <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#666' }}>
            <Tooltip title={t('cpuAnalysis.pidDecimal')}>
            <span>{record.pid}</span>
          </Tooltip>
          <span style={{ color: '#bbb', margin: '0 4px' }}>↔</span>
          <Tooltip title={t('cpuAnalysis.nidHex')}>
            <span>{record.nid}</span>
          </Tooltip>
        </span>
      ),
    },
    {
      title: t('cpuAnalysis.stateCol'),
      dataIndex: 'state',
      key: 'state',
      width: 120,
      render: (state: string, record) => (
        <Tag
          color={record.inDeadlock ? '#ff4d4f' : (state === 'RUNNABLE' ? 'blue' : state === 'BLOCKED' ? 'red' : 'default')}
          style={{ fontWeight: 600 }}
        >
          {state}
        </Tag>
      ),
    },
    {
      title: t('cpuAnalysis.topFrameCol'),
      dataIndex: 'topFrame',
      key: 'topFrame',
      width: 320,
      ellipsis: true,
      render: (frame: string) => (
        <Tooltip title={frame}>
          <span style={{ fontFamily: "'Menlo,Monaco,Consolas',monospace", fontSize: 11, color: '#555' }}>
            {frame}
          </span>
        </Tooltip>
      ),
    },
  ];

  const topDraggerProps: UploadProps = {
    name: 'topFile',
    multiple: false,
    accept: '.txt',
    fileList: topFileList,
    beforeUpload: () => false,
    onChange: (info) => {
      const latest = info.fileList.slice(-1);
      setTopFileList(latest);
    },
  };

  return (
    <Card
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Title level={5} style={{ margin: 0 }}>
            {t('cpuAnalysis.correlationTitle')}
          </Title>
          <ThunderboltOutlined style={{ color: '#fa8c16' }} />
          {topResult && (
            <Tag color={topResult.matchedCount > 0 ? 'green' : 'default'} style={{ fontSize: 11, margin: 0 }}>
              {t('cpuAnalysis.matchedCount', { count: topResult.matchedCount })}
            </Tag>
          )}
        </span>
      }
      extra={
        <Popover
          content={
            <div style={{ maxWidth: 560, fontSize: 13 }}>
              <p style={{ margin: '0 0 8px', fontWeight: 600 }}>{t('cpuAnalysis.correlationHelpTitle')}</p>
              <p style={{ margin: '0 0 8px', color: '#666' }}>{t('cpuAnalysis.correlationHelpDesc')}</p>
              <div style={{ background: '#f6f8fa', borderRadius: 6, padding: 12, fontFamily: 'monospace', fontSize: 12, lineHeight: 2 }}>
                <div>{t('cpuAnalysis.correlationPid', { pid: '12345' })}</div>
                <div>{t('cpuAnalysis.correlationNid', { nid: '0x3039' })}</div>
                <div style={{ color: '#52c41a' }}>{t('cpuAnalysis.correlationSame', { pid: '12345', nid: '3039' })}</div>
              </div>
              <p style={{ margin: '8px 0', fontWeight: 600 }}>{t('cpuAnalysis.correlationSteps')}</p>
              <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
                <li>{t('cpuAnalysis.correlationStep1')}</li>
                <li>{t('cpuAnalysis.correlationStep2')}</li>
                <li>{t('cpuAnalysis.correlationStep3')}</li>
                <li>{t('cpuAnalysis.correlationStep4')}</li>
                <li>{t('cpuAnalysis.correlationStep5')}</li>
              </ol>
              <p style={{ margin: '8px 0 0', color: '#999', fontSize: 12 }}>{t('cpuAnalysis.correlationNote')}</p>
            </div>
          }
          title={t('cpuAnalysis.correlationHelpTitle')} placement="topRight" trigger="hover"
        >
          <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
        </Popover>
      }
      style={{ marginTop: 16 }}
    >
      {/* 未上传时：提示 + 命令 demo */}
      {!topResult && (
        <div style={{ fontSize: 13, color: '#666', lineHeight: 2 }}>
          <p style={{ margin: '0 0 12px' }}>
            {t('cpuAnalysis.preciseExplanation')}
          </p>

          {/* 命令 demo */}
          <div style={{ background: '#f6f8fa', borderRadius: 8, padding: '16px 20px', marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 12, color: '#333', marginBottom: 8 }}>
              {t('cpuAnalysis.collectCmdTitle')}
            </div>
            <div
              style={{
                background: '#1e1e1e',
                color: '#d4d4d4',
                borderRadius: 6,
                padding: '12px 16px',
                fontFamily: "'Fira Code','Consolas','Courier New',monospace",
                fontSize: 12,
                lineHeight: 2,
              }}
            >
              <div style={{ color: '#6a9955' }}>{t('cpuAnalysis.collectCmdCombined')}</div>
              <div>
                <span style={{ color: '#dcdcaa' }}>{COMMAND_DEMO_COMBINED}</span>
              </div>
              <div style={{ color: '#6a9955', marginTop: 4 }}>{t('cpuAnalysis.collectCmdSeparate')}</div>
              <div>
                <span style={{ color: '#dcdcaa' }}>{COMMAND_DEMO_TOP}</span>
              </div>
              <div>
                <span style={{ color: '#dcdcaa' }}>{COMMAND_DEMO_JSTACK}</span>
              </div>
              <div style={{ color: '#6a9955', marginTop: 4 }}>{t('cpuAnalysis.collectCmdVerify')}</div>
              <div>
                <span style={{ color: '#dcdcaa' }}>printf '%x\n' {t('cpuAnalysis.topPidPlaceholder')}</span>
                <span style={{ color: '#569cd6' }}>{t('cpuAnalysis.hexComment')}</span>
              </div>
            </div>
          </div>

          {/* 上传区域 */}
          <Spin spinning={loading} tip={t('cpuAnalysis.analyzing')}>
            <Upload.Dragger {...topDraggerProps} style={{ borderRadius: 8, padding: '16px 0' }}>
              <p className="ant-upload-drag-icon">
                <UploadOutlined style={{ color: '#fa8c16', fontSize: 32 }} />
              </p>
              <p className="ant-upload-text" style={{ fontSize: 14, fontWeight: 500 }}>
                {t('cpuAnalysis.uploadAreaText')}
              </p>
              <p className="ant-upload-hint" style={{ fontSize: 12, color: '#999' }}>
                {t('cpuAnalysis.uploadAreaHint')}
              </p>
            </Upload.Dragger>

            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              onClick={handleAnalyze}
              loading={loading}
              disabled={topFileList.length === 0}
              block
              style={{ marginTop: 12, height: 40, fontSize: 14, borderRadius: 6 }}
            >
              {t('cpuAnalysis.analyzeButton')}
            </Button>
          </Spin>
        </div>
      )}

      {/* 上传后：展示结果 */}
      {topResult && (
        <div>
          {/* 统计概览 */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <Tag color="orange" style={{ fontSize: 13, padding: '4px 12px' }}>
              {t('cpuAnalysis.totalTopThreads', { count: topResult.totalThreads })}
            </Tag>
            <Tag color="blue" style={{ fontSize: 13, padding: '4px 12px' }}>
              {t('cpuAnalysis.matchedSuccess', { count: topResult.matchedCount })}
            </Tag>
            <Tag color="default" style={{ fontSize: 13, padding: '4px 12px' }}>
              {t('cpuAnalysis.unmatched', { count: topResult.unmatchedCount })}
            </Tag>
            <Tag color="green" style={{ fontSize: 13, padding: '4px 12px' }}>
              {t('cpuAnalysis.cpuTotal', { pct: topResult.totalCpuPercent.toFixed(1) })}
            </Tag>
            <Button
              type="link"
              size="small"
              onClick={() => { setTopResult(null); setTopFileList([]); }}
              style={{ fontSize: 12, padding: 0 }}
            >
              {t('cpuAnalysis.reupload')}
            </Button>
          </div>

          {/* top 匹配结果表格 */}
          {topResult.matchedCount > 0 ? (
            <Table<TopCpuThreadInfo>
              columns={topColumns}
              dataSource={topResult.threads.map((t, i) => ({ ...t, key: t.nid || `${i}` }))}
              size="small"
              pagination={{
                defaultPageSize: 15,
                showSizeChanger: true,
                pageSizeOptions: [10, 15, 20, 50],
                showTotal: (total) => t('threads.totalItems', { total }),
                size: 'small',
              }}
              scroll={{ x: 960 }}
              rowClassName={(record) => {
                if (record.cpuPercent > 50) return 'cpu-row-high';
                if (record.state !== 'RUNNABLE') return 'cpu-row-muted';
                return '';
              }}
            />
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <div style={{ textAlign: 'center' }}>
                  <Text strong style={{ fontSize: 14 }}>{t('cpuAnalysis.noMatched')}</Text>
                  <div style={{ marginTop: 4 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {t('cpuAnalysis.noMatchedDesc')}
                    </Text>
                  </div>
                </div>
              }
            />
          )}

          {/* 未匹配提示 */}
          {topResult.unmatchedCount > 0 && (
            <Alert
              type="info"
              showIcon
              style={{ marginTop: 12, borderRadius: 8, fontSize: 12 }}
              message={
                <span>
                  {t('cpuAnalysis.unmatchedNote', { count: topResult.unmatchedCount })}
                </span>
              }
            />
          )}
        </div>
      )}
      {/* 线程详情弹窗 */}
      <Modal
        title={selectedPreciseThread ? t('cpuAnalysis.modalTitlePrecise', { name: selectedPreciseThread.topInfo.name }) : t('cpuAnalysis.title')}
        open={!!selectedPreciseThread}
        onCancel={() => setSelectedPreciseThread(null)}
        footer={null}
        width={800}
      >
        {selectedPreciseThread && (
          <div>
            <p><strong>{t('cpuAnalysis.threadName')}</strong>
              <span style={{ fontFamily: "'Menlo,Monaco,Consolas',monospace", fontSize: 13 }}>{selectedPreciseThread.topInfo.name}</span>
            </p>
            <p>
              <strong>{t('cpuAnalysis.cpuUsage')}</strong>
              <span style={{
                fontWeight: 700,
                color: selectedPreciseThread.topInfo.cpuPercent > 50 ? '#ff4d4f'
                  : selectedPreciseThread.topInfo.cpuPercent > 20 ? '#fa8c16'
                  : selectedPreciseThread.topInfo.cpuPercent > 5 ? '#1677ff' : '#52c41a',
                fontSize: 15,
              }}>
                {selectedPreciseThread.topInfo.cpuPercent.toFixed(1)}%
              </span>
            </p>
            <p>
              <strong>{t('cpuAnalysis.threadId')}</strong>
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#666' }}>
                PID {selectedPreciseThread.topInfo.pid}
                <span style={{ color: '#bbb', margin: '0 4px' }}>↔</span>
                nid {selectedPreciseThread.topInfo.nid}
              </span>
            </p>
            <p>
              <strong>{t('cpuAnalysis.stateLabel')}</strong>
              <Tag
                color={selectedPreciseThread.topInfo.inDeadlock ? '#ff4d4f'
                  : (selectedPreciseThread.topInfo.state === 'RUNNABLE' ? 'blue'
                    : selectedPreciseThread.topInfo.state === 'BLOCKED' ? 'red' : 'default')}
                style={{ fontWeight: 600 }}
              >
                {selectedPreciseThread.topInfo.state}
              </Tag>
              {selectedPreciseThread.topInfo.inDeadlock && (
                <Tag color="#ff4d4f" icon={<BugOutlined />} style={{ marginLeft: 4 }}>{t('cpuAnalysis.deadlockTag')}</Tag>
              )}
            </p>
            <p><strong>{t('cpuAnalysis.stackTrace')}</strong></p>
            <pre style={{
              background: '#1e1e1e',
              color: '#d4d4d4',
              padding: 16,
              borderRadius: 8,
              fontSize: 12,
              lineHeight: 1.8,
              maxHeight: 400,
              overflow: 'auto',
              fontFamily: "'Fira Code', 'Consolas', 'Courier New', monospace",
            }}>
              {buildRawStackLines(selectedPreciseThread.thread).map((line, i) => {
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
        )}
      </Modal>
    </Card>
  );
};

const CpuAnalysis: React.FC<CpuAnalysisProps> = ({
  threads,
  jstackRawFile,
  cpuTopResult,
  setCpuTopResult,
  cpuTopFileList,
  setCpuTopFileList,
  view = 'inference',
}) => {
  const { t } = useTranslation();
  // ========== 状态管理 ==========
  const [selectedThread, setSelectedThread] = useState<CpuThreadResult | null>(null);

  // 分类 → i18n 标签映射
  const catLabel = (cat: ThreadCategory): string => {
    switch (cat) {
      case 'cpu_consuming': return t('cpuAnalysis.categoryCpu');
      case 'io_wait': return t('cpuAnalysis.categoryIo');
      case 'gc': return t('cpuAnalysis.categoryGc');
    }
  };
  const catDesc = (cat: ThreadCategory): string => {
    switch (cat) {
      case 'cpu_consuming': return t('cpuAnalysis.categoryCpuDesc');
      case 'io_wait': return t('cpuAnalysis.categoryIoDesc');
      case 'gc': return t('cpuAnalysis.categoryGcDesc');
    }
  };

  // ========== 核心评估逻辑 ==========
  const evalResults = useMemo((): CpuThreadResult[] => {
    const runnable = threads.filter((t) => t.state === 'RUNNABLE');
    if (runnable.length === 0) return [];

    // 统计相同栈帧出现的线程数（用于瓶颈检测）
    const stackSigMap = new Map<string, ThreadSummary[]>();
    runnable.forEach((t) => {
      const sig = t.stackTrace?.length > 0 ? t.stackTrace[0] : '';
      if (!sig) return;
      const list = stackSigMap.get(sig) || [];
      list.push(t);
      stackSigMap.set(sig, list);
    });

    return runnable.map((thread) => {
      const reasons: string[] = [];
      let category: ThreadCategory = 'cpu_consuming';
      const stack = thread.stackTrace || [];
      const topFrame = stack[0] || t('cpuAnalysis.noFrame');
      const stackDepth = stack.length;

      // --- 检查 Native I/O 等待 ---
      const isIoWait = stack.some((frame) =>
        IO_WAIT_NATIVE_PATTERNS.some((pat) => pat.test(frame)),
      );
      if (isIoWait) {
        category = 'io_wait';
        const matchedFrame = stack.find((f) =>
          IO_WAIT_NATIVE_PATTERNS.some((pat) => pat.test(f)),
        );
        reasons.push(t('cpuAnalysis.reasonIoWait', { frame: (matchedFrame?.substring(0, 60) || '') }));
        return { thread, category, reasons, stackDepth, topFrame };
      }

      // --- 检查 GC / 系统线程 ---
      const isGcThread = GC_NATIVE_PATTERNS.some((pat) => pat.test(thread.name));
      if (isGcThread) {
        category = 'gc';
        reasons.push(t('cpuAnalysis.reasonGcThread'));
        return { thread, category, reasons, stackDepth, topFrame };
      }

      // --- 检查异常模式（死循环、超深栈、共享瓶颈） ---
      // 这些是额外的诊断信息，但不改变分类（仍然是 cpu_consuming）
      if (stack.length > 3) {
        const frameSet = new Set(stack);
        if (frameSet.size < stack.length * 0.5) {
          reasons.push(t('cpuAnalysis.reasonLoopFrame', { total: stack.length, unique: frameSet.size }));
        }
      }

      // --- 检查超深栈 ---
      if (stackDepth > 150) {
        reasons.push(t('cpuAnalysis.reasonDeepStack', { count: stackDepth }));
      }

      // --- 检查共享栈帧（瓶颈检测） ---
      if (stack.length > 0) {
        const sameStack = stackSigMap.get(stack[0]);
        if (sameStack && sameStack.length > 1) {
          reasons.push(t('cpuAnalysis.reasonSharedTop', { count: sameStack.length }));
        }
      }

      // --- 默认评估 ---
      if (reasons.length === 0) {
        reasons.push(t('cpuAnalysis.reasonDefault'));
      }

      return { thread, category, reasons, stackDepth, topFrame };
    });
  }, [threads, t]);

  // ========== 分组统计 ==========
  const stats = useMemo(() => {
    const total = evalResults.length;
    const counts: Record<ThreadCategory, number> = {
      cpu_consuming: 0, io_wait: 0, gc: 0,
    };
    evalResults.forEach((r) => counts[r.category]++);
    return { total, counts };
  }, [evalResults]);

  // ========== 表格列 ==========
  const columns: ColumnsType<CpuThreadResult> = [
    {
      title: t('cpuAnalysis.category'),
      dataIndex: 'category',
      key: 'category',
      width: 140,
      filters: [
        { text: t('cpuAnalysis.categoryCpu'), value: 'cpu_consuming' },
        { text: t('cpuAnalysis.categoryIo'), value: 'io_wait' },
        { text: t('cpuAnalysis.categoryGc'), value: 'gc' },
      ],
      defaultFilteredValue: ['cpu_consuming'],
      onFilter: (value, record) => record.category === value,
      render: (category: ThreadCategory) => {
        const cfg = CATEGORY_CONFIG[category];
        return (
          <Tag color={cfg.tagColor} icon={cfg.icon}>
            {catLabel(category)}
          </Tag>
        );
      },
    },
    {
      title: t('cpuAnalysis.threadNameCol'),
      dataIndex: ['thread', 'name'],
      key: 'name',
      width: 300,
      ellipsis: true,
      render: (name: string, record: CpuThreadResult) => (
        <Tooltip title={name}>
          <span
            style={{
              fontFamily: 'Menlo, Monaco, Consolas, monospace',
              fontSize: 12,
              color: CATEGORY_CONFIG[record.category].color,
              cursor: 'pointer',
            }}
            onClick={() => setSelectedThread(record)}
          >
            {name}
          </span>
        </Tooltip>
      ),
    },
    {
      title: t('cpuAnalysis.evalReason'),
      dataIndex: 'reasons',
      key: 'reasons',
      render: (reasons: string[]) => (
        <div style={{ fontSize: 12, lineHeight: 1.6 }}>
          {reasons.map((r, i) => (
            <div key={i} style={{ color: '#666' }}>
              • {r}
            </div>
          ))}
        </div>
      ),
    },
    {
      title: t('cpuAnalysis.stackDepth'),
      dataIndex: 'stackDepth',
      key: 'stackDepth',
      width: 80,
      align: 'center',
      sorter: (a, b) => a.stackDepth - b.stackDepth,
      render: (depth: number) => (
        <span style={{ fontWeight: depth > 150 ? 700 : 400, color: depth > 150 ? '#ff4d4f' : '#666' }}>
          {depth}
        </span>
      ),
    },
    {
      title: t('cpuAnalysis.topFrameCol'),
      dataIndex: 'topFrame',
      key: 'topFrame',
      width: 360,
      ellipsis: true,
      render: (frame: string) => (
        <Tooltip title={frame}>
          <span style={{ fontFamily: 'Menlo, Monaco, Consolas, monospace', fontSize: 11, color: '#555' }}>
            {frame}
          </span>
        </Tooltip>
      ),
    },
  ];

  // ========== 无 RUNNABLE 线程 ==========
  if (stats.total === 0) {
    return (
      <Card
        title={
          <Title level={5} style={{ margin: 0 }}>
            {t('cpuAnalysis.title')}
          </Title>
        }
        extra={
          <Popover
            content={
              <div style={{ maxWidth: 600, fontSize: 13 }}>
                <p style={{ margin: '0 0 8px', fontWeight: 600 }}>{t('cpuAnalysis.evalMethodTitle')}</p>
                <p style={{ margin: '0 0 6px', color: '#666' }}>{t('cpuAnalysis.evalMethodContent')}</p>
                <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
                  <li>{t('cpuAnalysis.evalMethodStep1')}</li>
                  <li>{t('cpuAnalysis.evalMethodStep2')}</li>
                  <li>{t('cpuAnalysis.evalMethodStep3')}</li>
                  <li>{t('cpuAnalysis.evalMethodStep4')}</li>
                </ol>
                <p style={{ margin: '8px 0 0', color: '#999', fontSize: 12 }}>{t('cpuAnalysis.evalMethodNote')}</p>
              </div>
            }
            title={t('cpuAnalysis.evalMethodTitle')} placement="topRight" trigger="hover"
          >
            <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
          </Popover>
        }
      >
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <div style={{ textAlign: 'center' }}>
              <Text strong style={{ fontSize: 14 }}>
                {t('cpuAnalysis.noRunnable')}
              </Text>
              <div style={{ marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('cpuAnalysis.noRunnableDesc')}
                </Text>
              </div>
            </div>
          }
        />
      </Card>
    );
  }

  const cpuConsuming = stats.counts.cpu_consuming;

  return (
    <div>
      {view === 'inference' && (
        <>
          {/* 统计概览 */}
          <Card
            title={
              <Title level={5} style={{ margin: 0 }}>
                {t('cpuAnalysis.inferredTitle')}
              </Title>
            }
            extra={
              <Popover
            content={
              <div style={{ maxWidth: 600, fontSize: 13 }}>
                <p style={{ margin: '0 0 8px', fontWeight: 600 }}>{t('cpuAnalysis.evalMethodTitle')}</p>
                <p style={{ margin: '0 0 6px', color: '#666' }}>{t('cpuAnalysis.evalMethodContent')}</p>
                <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
                  <li>{t('cpuAnalysis.evalMethodStep1')}</li>
                  <li>{t('cpuAnalysis.evalMethodStep2')}</li>
                  <li>{t('cpuAnalysis.evalMethodStep3')}</li>
                  <li>{t('cpuAnalysis.evalMethodStep4')}</li>
                </ol>
                <p style={{ margin: '8px 0 0', color: '#999', fontSize: 12 }}>{t('cpuAnalysis.evalMethodNote')}</p>
              </div>
            }
            title={t('cpuAnalysis.evalMethodTitle')} placement="topRight" trigger="hover"
          >
                <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
              </Popover>
            }
            style={{ marginBottom: 16 }}
          >
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Tag color="blue" style={{ fontSize: 13, padding: '4px 12px' }}>
                {t('cpuAnalysis.runnableCount', { count: stats.total })}
              </Tag>
              {cpuConsuming > 0 && (
                <Tag color="red" style={{ fontSize: 13, padding: '4px 12px' }}>
                  {t('cpuAnalysis.cpuConsuming', { count: cpuConsuming })}
                </Tag>
              )}
              {stats.counts.io_wait > 0 && (
                <Tag color="default" style={{ fontSize: 13, padding: '4px 12px' }}>
                  {t('cpuAnalysis.ioWaiting', { count: stats.counts.io_wait })}
                </Tag>
              )}
              {stats.counts.gc > 0 && (
                <Tag color="cyan" style={{ fontSize: 13, padding: '4px 12px' }}>
                  {t('cpuAnalysis.gcSystem', { count: stats.counts.gc })}
                </Tag>
              )}
            </div>

            {cpuConsuming > 0 && (
              <Alert
                type="warning"
                showIcon
                message={t('cpuAnalysis.alertCpu', { count: cpuConsuming })}
                style={{ marginTop: 12, borderRadius: 8 }}
              />
            )}
          </Card>

          {/* 评估结果表格 */}
          <Card
            title={
              <Title level={5} style={{ margin: 0 }}>
                {t('cpuAnalysis.evalDetailTitle')}
              </Title>
            }
          >
            <Table<CpuThreadResult>
              columns={columns}
              dataSource={evalResults.map((r, i) => ({ ...r, key: r.thread.nid || r.thread.name || `${i}` }))}
              size="small"
              pagination={{
                defaultPageSize: 15,
                showSizeChanger: true,
                pageSizeOptions: [10, 15, 20, 50],
                showTotal: (total) => t('cpuAnalysis.totalItems', { total }),
                size: 'small',
              }}
              scroll={{ x: 900 }}
              rowClassName={(record) => {
                if (record.category === 'cpu_consuming') return 'cpu-row-high';
                if (record.category === 'io_wait' || record.category === 'gc') return 'cpu-row-muted';
                return '';
              }}
            />
            <style>{`
              .cpu-row-high {
                background: #fff2f0 !important;
              }
              .cpu-row-high:hover td {
                background: #ffe7e2 !important;
              }
              .cpu-row-muted {
                background: #fafafa !important;
                opacity: 0.75;
              }
              .cpu-row-muted:hover td {
                background: #f5f5f5 !important;
                opacity: 1;
              }
            `}</style>
          </Card>

          {/* 线程详情弹窗 */}
          <Modal
            title={selectedThread ? t('cpuAnalysis.modalTitle', { name: selectedThread.thread.name }) : t('cpuAnalysis.title')}
            open={!!selectedThread}
            onCancel={() => setSelectedThread(null)}
            footer={null}
            width={800}
          >
            {selectedThread && (
              <div>
                <p><strong>{t('cpuAnalysis.threadName')}</strong>{selectedThread.thread.name}</p>
                <p><strong>{t('cpuAnalysis.stateLabel')}</strong>{selectedThread.thread.state}</p>
                <p><strong>{t('cpuAnalysis.category')}</strong>
                  <Tag color={CATEGORY_CONFIG[selectedThread.category].tagColor} icon={CATEGORY_CONFIG[selectedThread.category].icon}>
                    {catLabel(selectedThread.category)}
                  </Tag>
                </p>
                <p><strong>{t('cpuAnalysis.evalReason')}</strong></p>
                <ul style={{ color: '#666', lineHeight: 1.8 }}>
                  {selectedThread.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                <p><strong>{t('cpuAnalysis.stackTrace')}</strong></p>
                <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 16, borderRadius: 8, fontSize: 12, lineHeight: 1.8, maxHeight: 400, overflow: 'auto', fontFamily: "'Fira Code', 'Consolas', 'Courier New', monospace" }}>
                  {buildRawStackLines(selectedThread.thread).map((line, i) => {
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
            )}
          </Modal>
        </>
      )}
      {view === 'precise' && (
        <PreciseCpuCollection
          threads={threads}
          jstackRawFile={jstackRawFile}
          topResult={cpuTopResult}
          setTopResult={setCpuTopResult}
          topFileList={cpuTopFileList}
          setTopFileList={setCpuTopFileList}
        />
      )}
    </div>
  );
};

export default CpuAnalysis;
