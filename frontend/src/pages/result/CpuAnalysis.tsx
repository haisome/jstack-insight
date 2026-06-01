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
  label: string;
  color: string;
  bg: string;
  tagColor: string;
  icon: React.ReactNode;
  desc: string;
}> = {
  cpu_consuming: {
    label: 'CPU 消耗',
    color: '#ff4d4f',
    bg: '#fff2f0',
    tagColor: 'red',
    icon: <FireOutlined />,
    desc: 'RUNNABLE 且非 Native I/O 等待，疑似在消耗 CPU',
  },
  io_wait: {
    label: 'I/O 等待',
    color: '#8c8c8c',
    bg: '#fafafa',
    tagColor: 'default',
    icon: <CheckCircleOutlined />,
    desc: 'RUNNABLE 但栈顶为 Native I/O 等待方法，实际不消耗 CPU',
  },
  gc: {
    label: 'GC/系统',
    color: '#13c2c2',
    bg: '#e6fffb',
    tagColor: 'cyan',
    icon: <WarningOutlined />,
    desc: 'RUNNABLE 但为 GC 或 JVM 系统线程，非业务 CPU 消耗',
  },
};

/** 评估问号 Tooltip 内容 */
const EVALUATION_METHOD = (
  <div style={{ maxWidth: 600, fontSize: 13 }}>
    <p style={{ margin: '0 0 8px', fontWeight: 600 }}>CPU 消耗线程推测方法</p>
    <p style={{ margin: '0 0 6px', color: '#666' }}>
      基于 fastthread 的「Really Running」分析理念，jstack 中标记为 RUNNABLE 的线程并非都在消耗 CPU。
    </p>

    <p style={{ margin: '0 0 8px', fontWeight: 600 }}>评估步骤：</p>
    <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
      <li>筛选所有 <Tag color="blue" style={{ marginLeft: 4 }}>RUNNABLE</Tag> 状态的线程</li>
      <li>检查栈顶是否命中 <Text code>Native Method</Text> I/O 等待模式（socketRead0、epollWait 等）→ 标记为「I/O 等待」</li>
      <li>检查线程名是否为 GC / JVM 系统线程 → 标记为「GC/系统」</li>
      <li>剩余线程标记为「CPU 消耗」（疑似在消耗 CPU）</li>
    </ol>

    <p style={{ margin: '12px 0 8px', fontWeight: 600 }}>分类说明：</p>
    <div style={{ background: '#fff2f0', borderRadius: 6, padding: '8px 12px', marginBottom: 8 }}>
      <div style={{ marginBottom: 6 }}>
        <Tag color="red" style={{ marginRight: 4 }}>CPU 消耗</Tag>
        <span style={{ color: '#666' }}>RUNNABLE 且非 Native I/O 等待，疑似在消耗 CPU</span>
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, color: '#666', lineHeight: 1.8 }}>
        <li>可能是业务计算线程、死循环、或瓶颈点</li>
        <li>需结合 top -H 或 async-profiler 确认实际 CPU 占用</li>
      </ul>
    </div>

    <div style={{ background: '#fafafa', borderRadius: 6, padding: '8px 12px', marginBottom: 8 }}>
      <div style={{ marginBottom: 6 }}>
        <Tag color="default" style={{ marginRight: 4 }}>I/O 等待</Tag>
        <span style={{ color: '#666' }}>RUNNABLE 但栈顶为 Native I/O 等待方法，实际不消耗 CPU</span>
      </div>
    </div>

    <div style={{ background: '#e6fffb', borderRadius: 6, padding: '8px 12px', marginBottom: 8 }}>
      <div style={{ marginBottom: 6 }}>
        <Tag color="cyan" style={{ marginRight: 4 }}>GC/系统</Tag>
        <span style={{ color: '#666' }}>RUNNABLE 但为 GC 或 JVM 系统线程，非业务 CPU 消耗</span>
      </div>
    </div>

    <p style={{ margin: '10px 0 4px', fontWeight: 600 }}>参考来源：</p>
    <ul style={{ margin: 0, paddingLeft: 18, color: '#666' }}>
      <li>fastthread: "Really Running" — blog.fastthread.io/really-running</li>
      <li>JVM 将 Native 方法中的线程统一标记为 RUNNABLE，无法区分计算与 I/O 阻塞</li>
    </ul>
    <p style={{ margin: '8px 0 0', color: '#999', fontSize: 12 }}>
      ⚠️ 此方法为推测性分析，结果仅供排查参考。精确 CPU 数据需结合 top -H -p pid 或 async-profiler。
    </p>
  </div>
);

/** CPU 关联原理说明 */
const CPU_CORRELATION_PRINCIPLE = (
  <div style={{ maxWidth: 560, fontSize: 13 }}>
    <p style={{ margin: '0 0 8px', fontWeight: 600 }}>PID ↔ NID 关联原理</p>
    <p style={{ margin: '0 0 8px', color: '#666' }}>
      Linux 系统中，每个 Java 线程对应一个系统原生线程（LWP）。
      <code>top -H</code> 和 <code>jstack</code> 都能看到这个线程，只是标识方式不同：
    </p>
    <div style={{ background: '#f6f8fa', borderRadius: 6, padding: 12, fontFamily: 'monospace', fontSize: 12, lineHeight: 2 }}>
      <div>top -H 显示：<span style={{ color: '#1677ff' }}>PID = 12345</span>（十进制）</div>
      <div>jstack 显示：<span style={{ color: '#1677ff' }}>nid = 0x3039</span>（十六进制）</div>
      <div style={{ color: '#52c41a' }}>二者是同一值：12345₁₀ = 3039₁₆</div>
    </div>
    <p style={{ margin: '8px 0', fontWeight: 600 }}>关联步骤：</p>
    <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
      <li>使用 <code>top -H -p &lt;pid&gt;</code> 采集线程级 CPU 数据</li>
      <li>解析 top 输出中每行的 PID（十进制）和 %CPU</li>
      <li>将 PID 转换为十六进制（去 <code>0x</code> 前缀）</li>
      <li>与 jstack 中的 <code>nid</code> 字段进行精确匹配</li>
      <li>匹配成功则将 top 中的 CPU% 赋给对应 jstack 线程</li>
    </ol>
    <p style={{ margin: '8px 0 0', color: '#999', fontSize: 12 }}>
      注意：top -H 的数据是瞬时快照，建议在 CPU 峰值时执行采集。
    </p>
  </div>
);

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
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async () => {
    if (topFileList.length === 0) {
      message.warning('请先上传 top 文件');
      return;
    }

    const topRawFile = topFileList[0].originFileObj;
    if (!topRawFile) {
      message.error('文件对象异常，请重新选择');
      return;
    }

    setLoading(true);
    try {
      const result = await uploadTopForCpu(jstackRawFile!, topRawFile);
      setTopResult(result);
      message.success(`关联完成：${result.matchedCount} 个线程匹配成功`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '分析失败，请重试';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const topColumns: ColumnsType<TopCpuThreadInfo> = [
    {
      title: 'CPU%',
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
      title: 'CPU% 占比',
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
      title: '线程名',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name: string, record) => (
        <Tooltip title={name}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: "'Menlo,Monaco,Consolas',monospace", fontSize: 12 }}>
            {record.inDeadlock && <BugOutlined style={{ color: '#ff4d4f' }} />}
            {name}
          </span>
        </Tooltip>
      ),
    },
    {
      title: '线程ID',
      key: 'pid',
      width: 140,
      render: (_: unknown, record) => (
        <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#666' }}>
            <Tooltip title="top 中的十进制 PID">
            <span>{record.pid}</span>
          </Tooltip>
          <span style={{ color: '#bbb', margin: '0 4px' }}>↔</span>
          <Tooltip title="jstack 中的十六进制 nid">
            <span>{record.nid}</span>
          </Tooltip>
        </span>
      ),
    },
    {
      title: '状态',
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
      title: '栈顶',
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
            精准 CPU 采集
          </Title>
          <ThunderboltOutlined style={{ color: '#fa8c16' }} />
          {topResult && (
            <Tag color={topResult.matchedCount > 0 ? 'green' : 'default'} style={{ fontSize: 11, margin: 0 }}>
              {topResult.matchedCount} 线程匹配
            </Tag>
          )}
        </span>
      }
      extra={
        <Popover content={CPU_CORRELATION_PRINCIPLE} title="PID ↔ NID 关联原理" placement="topRight" trigger="hover">
          <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
        </Popover>
      }
      style={{ marginTop: 16 }}
    >
      {/* 未上传时：提示 + 命令 demo */}
      {!topResult && (
        <div style={{ fontSize: 13, color: '#666', lineHeight: 2 }}>
          <p style={{ margin: '0 0 12px' }}>
            基于单次 jstack 快照的推测，无法精确量化 CPU 占用率。
            上传 <Text strong>top -H</Text> 文件后，通过 TOP的PID(十进制) ↔ JStack的NID(十六进制) 关联，
            获得每个线程的精确 CPU 占用率。
          </p>

          {/* 命令 demo */}
          <div style={{ background: '#f6f8fa', borderRadius: 8, padding: '16px 20px', marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 12, color: '#333', marginBottom: 8 }}>
              采集命令（在同一台服务器上执行）：
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
              <div style={{ color: '#6a9955' }}># 一步到位：同时采集 top 和 jstack</div>
              <div>
                <span style={{ color: '#dcdcaa' }}>{COMMAND_DEMO_COMBINED}</span>
              </div>
              <div style={{ color: '#6a9955', marginTop: 4 }}># 也可分开执行：</div>
              <div>
                <span style={{ color: '#dcdcaa' }}>{COMMAND_DEMO_TOP}</span>
              </div>
              <div>
                <span style={{ color: '#dcdcaa' }}>{COMMAND_DEMO_JSTACK}</span>
              </div>
              <div style={{ color: '#6a9955', marginTop: 4 }}># 交叉验证（可选）：将 top 中的 PID 转为十六进制后在 jstack 中搜索</div>
              <div>
                <span style={{ color: '#dcdcaa' }}>printf '%x\n' {'<top中的PID>'}</span>
                <span style={{ color: '#569cd6' }}> # 输出十六进制</span>
              </div>
            </div>
          </div>

          {/* 上传区域 */}
          <Spin spinning={loading} tip="关联分析中...">
            <Upload.Dragger {...topDraggerProps} style={{ borderRadius: 8, padding: '16px 0' }}>
              <p className="ant-upload-drag-icon">
                <UploadOutlined style={{ color: '#fa8c16', fontSize: 32 }} />
              </p>
              <p className="ant-upload-text" style={{ fontSize: 14, fontWeight: 500 }}>
                点击或拖拽 top 文件到此处
              </p>
              <p className="ant-upload-hint" style={{ fontSize: 12, color: '#999' }}>
                仅支持 .txt 格式
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
              开始关联分析
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
              top 线程总数：{topResult.totalThreads}
            </Tag>
            <Tag color="blue" style={{ fontSize: 13, padding: '4px 12px' }}>
              匹配成功：{topResult.matchedCount}
            </Tag>
            <Tag color="default" style={{ fontSize: 13, padding: '4px 12px' }}>
              未匹配：{topResult.unmatchedCount}
            </Tag>
            <Tag color="green" style={{ fontSize: 13, padding: '4px 12px' }}>
              CPU 总和：{topResult.totalCpuPercent.toFixed(1)}%
            </Tag>
            <Button
              type="link"
              size="small"
              onClick={() => { setTopResult(null); setTopFileList([]); }}
              style={{ fontSize: 12, padding: 0 }}
            >
              重新上传
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
                showTotal: (total) => `共 ${total} 个线程`,
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
                  <Text strong style={{ fontSize: 14 }}>未能匹配到任何线程</Text>
                  <div style={{ marginTop: 4 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      请确认 top 文件和 jstack 文件来自同一进程、同一时刻采集
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
                  {topResult.unmatchedCount} 个 top 线程未在 jstack 中找到匹配（可能是 JVM 内部线程或采集时序差异）
                </span>
              }
            />
          )}
        </div>
      )}
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
  // ========== 状态管理 ==========
  const [selectedThread, setSelectedThread] = useState<CpuThreadResult | null>(null);

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

    return runnable.map((t) => {
      const reasons: string[] = [];
      let category: ThreadCategory = 'cpu_consuming';
      const stack = t.stackTrace || [];
      const topFrame = stack[0] || '无栈帧';
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
        reasons.push(`栈顶含 Native I/O 等待方法：${matchedFrame?.substring(0, 60)}`);
        return { thread: t, category, reasons, stackDepth, topFrame };
      }

      // --- 检查 GC / 系统线程 ---
      const isGcThread = GC_NATIVE_PATTERNS.some((pat) => pat.test(t.name));
      if (isGcThread) {
        category = 'gc';
        reasons.push('为 GC 或 JVM 系统线程');
        return { thread: t, category, reasons, stackDepth, topFrame };
      }

      // --- 检查异常模式（死循环、超深栈、共享瓶颈） ---
      // 这些是额外的诊断信息，但不改变分类（仍然是 cpu_consuming）
      if (stack.length > 3) {
        const frameSet = new Set(stack);
        if (frameSet.size < stack.length * 0.5) {
          reasons.push(`检测到重复栈帧（${stack.length} 帧中仅 ${frameSet.size} 个唯一帧），疑似死循环或无限递归`);
        }
      }

      // --- 检查超深栈 ---
      if (stackDepth > 150) {
        reasons.push(`调用栈异常深（${stackDepth} 帧），疑似深度递归或复杂调用`);
      }

      // --- 检查共享栈帧（瓶颈检测） ---
      if (stack.length > 0) {
        const sameStack = stackSigMap.get(stack[0]);
        if (sameStack && sameStack.length > 1) {
          reasons.push(`与 ${sameStack.length} 个线程共享相同栈顶（疑似瓶颈点）`);
        }
      }

      // --- 默认评估 ---
      if (reasons.length === 0) {
        reasons.push('RUNNABLE 且栈顶无 Native I/O 等待，推测为业务计算线程');
      }

      return { thread: t, category, reasons, stackDepth, topFrame };
    });
  }, [threads]);

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
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 120,
      filters: [
        { text: 'CPU 消耗', value: 'cpu_consuming' },
        { text: 'I/O 等待', value: 'io_wait' },
        { text: 'GC/系统', value: 'gc' },
      ],
      defaultFilteredValue: ['cpu_consuming'],
      onFilter: (value, record) => record.category === value,
      render: (category: ThreadCategory) => {
        const cfg = CATEGORY_CONFIG[category];
        return (
          <Tag color={cfg.tagColor} icon={cfg.icon}>
            {cfg.label}
          </Tag>
        );
      },
    },
    {
      title: '线程名',
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
      title: '评估理由',
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
      title: '栈深度',
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
      title: '栈顶',
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
            CPU 分析
          </Title>
        }
        extra={
          <Popover content={EVALUATION_METHOD} title="评估方法说明" placement="topRight" trigger="hover">
            <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
          </Popover>
        }
      >
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <div style={{ textAlign: 'center' }}>
              <Text strong style={{ fontSize: 14 }}>
                当前 jstack 文件中没有 RUNNABLE 状态的线程
              </Text>
              <div style={{ marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  无法进行 CPU 消耗推测，所有线程均处于等待或阻塞状态
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
                CPU 分析 — 线程消耗推测
              </Title>
            }
            extra={
              <Popover content={EVALUATION_METHOD} title="评估方法说明" placement="topRight" trigger="hover">
                <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
              </Popover>
            }
            style={{ marginBottom: 16 }}
          >
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Tag color="blue" style={{ fontSize: 13, padding: '4px 12px' }}>
                RUNNABLE 线程：{stats.total}
              </Tag>
              {cpuConsuming > 0 && (
                <Tag color="red" style={{ fontSize: 13, padding: '4px 12px' }}>
                  疑似 CPU 消耗：{cpuConsuming}
                </Tag>
              )}
              {stats.counts.io_wait > 0 && (
                <Tag color="default" style={{ fontSize: 13, padding: '4px 12px' }}>
                  I/O 等待（非 CPU）：{stats.counts.io_wait}
                </Tag>
              )}
              {stats.counts.gc > 0 && (
                <Tag color="cyan" style={{ fontSize: 13, padding: '4px 12px' }}>
                  GC/系统：{stats.counts.gc}
                </Tag>
              )}
            </div>

            {cpuConsuming > 0 && (
              <Alert
                type="warning"
                showIcon
                message={`发现 ${cpuConsuming} 个疑似 CPU 消耗线程，此方法为推测性分析，结果仅供排查参考。`}
                style={{ marginTop: 12, borderRadius: 8 }}
              />
            )}
          </Card>

          {/* 评估结果表格 */}
          <Card
            title={
              <Title level={5} style={{ margin: 0 }}>
                RUNNABLE 线程评估详情
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
                showTotal: (total) => `共 ${total} 条`,
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
            title={selectedThread ? `线程详情 - ${selectedThread.thread.name}` : '线程详情'}
            open={!!selectedThread}
            onCancel={() => setSelectedThread(null)}
            footer={null}
            width={800}
          >
            {selectedThread && (
              <div>
                <p><strong>线程名：</strong>{selectedThread.thread.name}</p>
                <p><strong>状态：</strong>{selectedThread.thread.state}</p>
                <p><strong>分类：</strong>
                  <Tag color={CATEGORY_CONFIG[selectedThread.category].tagColor} icon={CATEGORY_CONFIG[selectedThread.category].icon}>
                    {CATEGORY_CONFIG[selectedThread.category].label}
                  </Tag>
                </p>
                <p><strong>评估理由：</strong></p>
                <ul style={{ color: '#666', lineHeight: 1.8 }}>
                  {selectedThread.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                <p><strong>栈跟踪：</strong></p>
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
