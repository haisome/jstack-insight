import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { Layout, Menu, Button, Space, Typography, Tag, Breadcrumb, Spin, App, Popover } from 'antd';
import type { UploadFile } from 'antd';
import { useParams, useNavigate } from 'react-router-dom';
import {
  HomeOutlined,
  UnorderedListOutlined,
  ApiOutlined,
  FireOutlined,
  ArrowLeftOutlined,
  BugOutlined,
  ClusterOutlined,
  LockOutlined,
  CopyOutlined,
  BulbOutlined,
  AimOutlined,
  ThunderboltOutlined,
  ShareAltOutlined,
  DownloadOutlined,
  HeartFilled,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import { getReportSummary, getThreadsSummary, getReportLockGraph, getReportFlameGraph, getReportDeadlocks, extendReport, getThreadsIdx, getThreadsBucket, getReportStackGroups, getExportHtmlUrl, getCpuInference } from '../../services/api';
import type { ReportSummary, ThreadStateVO, LockGraphVO, FlameGraphVO, DeadlockChainVO, TopCpuVO, ThreadSummary, StackGroupVO, CpuInferenceVO } from '../../types';

const { Sider, Content } = Layout;
const { Title } = Typography;

/** 面板类型 */
type Panel = 'overview' | 'thread-list' | 'thread-groups' | 'thread-group'
  | 'lock-graph' | 'lock-deadlock' | 'flame-graph'
  | 'cpu-inference' | 'cpu-precise';

// 懒加载面板，切到对应 tab 才加载组件
const Overview = lazy(() => import('./Overview'));
const Threads = lazy(() => import('./Threads'));
const ThreadGroups = lazy(() => import('./ThreadGroups'));
const LockGraph = lazy(() => import('./LockGraph'));
const DeadlockDetail = lazy(() => import('./DeadlockDetail'));
const FlameGraph = lazy(() => import('./FlameGraph'));
const CpuAnalysis = lazy(() => import('./CpuAnalysis'));

/**
 * 分享报告结果页。
 *
 * <p>与 ResultPage 不同，本页面不接收全量数据，而是通过 URL 中的 UUID
 * 按需从后端加载各个模块的数据。首屏仅加载摘要（~200B），
 * 切换 tab 时才请求对应的详细数据。
 */
const ReportResultPage: React.FC = () => {
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { message } = App.useApp();

  const [activeTab, setActiveTab] = useState<Panel>('overview');
  const [collapsed, setCollapsed] = useState(false);

  // 摘要（首屏加载）
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  // 各面板数据（按需加载）
  const [threadsData, setThreadsData] = useState<ThreadStateVO | null>(null);
  const [lockGraphData, setLockGraphData] = useState<LockGraphVO | null>(null);
  const [flameGraphData, setFlameGraphData] = useState<FlameGraphVO | null>(null);
  const [deadlockData, setDeadlockData] = useState<DeadlockChainVO | null>(null);

  // 加载状态
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [lockGraphLoading, setLockGraphLoading] = useState(false);
  const [flameGraphLoading, setFlameGraphLoading] = useState(false);
  const [deadlockLoading, setDeadlockLoading] = useState(false);

  // CPU 分析状态（精准模式需要上传 top 文件）
  const [cpuTopResult, setCpuTopResult] = useState<TopCpuVO | null>(null);
  const [cpuTopFileList, setCpuTopFileList] = useState<UploadFile[]>([]);
  // CPU 线程推测结果（后端计算，与导出报告同源）
  const [cpuInference, setCpuInference] = useState<CpuInferenceVO | null>(null);
  const [cpuInferenceLoading, setCpuInferenceLoading] = useState(false);

  // 线程分桶索引 + 缓存（避免每次展开都请求）
  const [threadsIdx, setThreadsIdx] = useState<Record<number, number> | null>(null);
  const bucketCacheRef = useRef<Map<number, ThreadSummary[]>>(new Map());
  const [bucketCacheVersion, setBucketCacheVersion] = useState(0);
  const [threadsFull, setThreadsFull] = useState<ThreadSummary[] | null>(null);
  const [threadsFullLoading, setThreadsFullLoading] = useState(false);
  const [stackGroups, setStackGroups] = useState<StackGroupVO[] | null>(null);

  // 首屏加载摘要
  useEffect(() => {
    if (!uuid) return;
    setSummaryLoading(true);
    getReportSummary(uuid)
      .then(setSummary)
      .catch((err) => {
        message.error('报告加载失败：' + (err instanceof Error ? err.message : '未知错误'));
        navigate('/');
      })
      .finally(() => setSummaryLoading(false));
  }, [uuid, message, navigate]);

  // 按需加载数据
  useEffect(() => {
    if (!uuid || !summary) return;

    const tab = activeTab;
    switch (tab) {
      case 'overview':
      case 'cpu-precise':
      case 'thread-group':
        if (!threadsData) {
          setThreadsLoading(true);
          getThreadsSummary(uuid)
            .then(setThreadsData)
            .catch((err) => message.error('线程数据加载失败：' + (err instanceof Error ? err.message : '未知')))
            .finally(() => setThreadsLoading(false));
        }
        break;
      case 'cpu-inference':
        // CPU 推测依赖完整调用栈，由后端基于全量线程详情计算，与导出报告同源
        if (!cpuInference) {
          setCpuInferenceLoading(true);
          getCpuInference(uuid)
            .then(setCpuInference)
            .catch((err) => message.error('CPU 推测数据加载失败：' + (err instanceof Error ? err.message : '未知')))
            .finally(() => setCpuInferenceLoading(false));
        }
        break;
      case 'thread-list':
        if (!threadsData) {
          setThreadsLoading(true);
          getThreadsSummary(uuid)
            .then(setThreadsData)
            .catch((err) => message.error('线程数据加载失败：' + (err instanceof Error ? err.message : '未知')))
            .finally(() => setThreadsLoading(false));
        }
        if (!threadsIdx) {
          getThreadsIdx(uuid).then(setThreadsIdx).catch(() => {});
        }
        break;
      case 'thread-groups':
        if (!stackGroups) {
          setThreadsFullLoading(true);
          getReportStackGroups(uuid)
            .then(setStackGroups)
            .catch(() => {})
            .finally(() => setThreadsFullLoading(false));
        }
        break;
      case 'lock-graph':
      case 'lock-deadlock':
        if (!lockGraphData) {
          setLockGraphLoading(true);
          getReportLockGraph(uuid)
            .then(setLockGraphData)
            .catch((err) => message.error('锁图数据加载失败：' + (err instanceof Error ? err.message : '未知')))
            .finally(() => setLockGraphLoading(false));
        }
        if (!deadlockData) {
          setDeadlockLoading(true);
          getReportDeadlocks(uuid)
            .then(setDeadlockData)
            .catch((err) => message.error('死锁数据加载失败：' + (err instanceof Error ? err.message : '未知')))
            .finally(() => setDeadlockLoading(false));
        }
        break;
      case 'flame-graph':
        if (!flameGraphData) {
          setFlameGraphLoading(true);
          getReportFlameGraph(uuid)
            .then(setFlameGraphData)
            .catch((err) => message.error('火焰图数据加载失败：' + (err instanceof Error ? err.message : '未知')))
            .finally(() => setFlameGraphLoading(false));
        }
        break;
    }
  }, [activeTab, uuid, summary, message]);

  // 按需加载分桶（带缓存，用 useRef 避免每次新增都全量复制 Map）
  const loadBucket = async (bucket: number) => {
    if (!uuid || bucketCacheRef.current.has(bucket)) return;
    try {
      const threads = await getThreadsBucket(uuid, bucket);
      bucketCacheRef.current.set(bucket, threads);
      setBucketCacheVersion(v => v + 1); // 仅触发一次轻量重渲染
    } catch { /* ignore */ }
  };

  const handleBack = () => navigate('/');
  const lastShareTimeRef = useRef(0);
  const cachedExpiresAtRef = useRef(0);

  // 导出防抖：1 秒内仅允许 1 次，累计超过 10 次禁止
  const lastExportTimeRef = useRef(0);
  const exportCountRef = useRef(0);
  const EXPORT_MAX_COUNT = 10;
  const EXPORT_INTERVAL_MS = 1000;

  const handleExport = () => {
    if (!uuid) return;

    // 累计次数限制
    if (exportCountRef.current >= EXPORT_MAX_COUNT) {
      message.warning(t('result.exportLimitReached'));
      return;
    }

    // 1 秒防抖
    const now = Date.now();
    if (now - lastExportTimeRef.current < EXPORT_INTERVAL_MS) {
      message.info(t('result.exportTooFrequent'));
      return;
    }

    lastExportTimeRef.current = now;
    exportCountRef.current += 1;

    // 触发下载（通过隐藏的 <a> 或直接 window.open）
    const url = getExportHtmlUrl(uuid);
    const link = document.createElement('a');
    link.href = url;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleShare = async () => {
    if (!uuid) return;
    const url = `${window.location.origin}/report/${uuid}`;

    // 2 小时内不再请求后端续期，直接复制并显示缓存的过期时间
    const now = Date.now();
    if (now - lastShareTimeRef.current < 2 * 60 * 60 * 1000) {
      await navigator.clipboard.writeText(url);
      const expiryStr = new Date(cachedExpiresAtRef.current).toLocaleString();
      message.success(t('result.shareCopied', { time: expiryStr }));
      return;
    }

    try {
      const expiresAt = await extendReport(uuid);
      lastShareTimeRef.current = now;
      cachedExpiresAtRef.current = expiresAt;
      await navigator.clipboard.writeText(url);
      const expiryStr = new Date(expiresAt).toLocaleString();
      message.success(t('result.shareCopied', { time: expiryStr }));
    } catch {
      message.info(`分享链接: /report/${uuid}`);
    }
  };

  // 截取简短 UUID 用于展示（前 8 位是日期前缀，取后 8 位）
  const shortUuid = uuid ? uuid.substring(uuid.length - 8) : '';

  const menuItems = [
    { key: 'overview', icon: <HomeOutlined />, label: t('result.menuOverview') },
    {
      key: 'thread-analysis',
      icon: <UnorderedListOutlined />,
      label: t('result.menuThreadAnalysis'),
      children: [
        { key: 'thread-list', icon: <UnorderedListOutlined />, label: t('result.menuThreadList') },
        { key: 'thread-group', icon: <ClusterOutlined />, label: t('result.menuThreadGroup') },
        { key: 'thread-groups', icon: <CopyOutlined />, label: t('result.menuSameStackAnalysis') },
      ],
    },
    {
      key: 'lock-analysis',
      icon: (
        <span style={{ position: 'relative' }}>
          <ApiOutlined />
          {summary?.hasDeadlock && (
            <span style={{ position: 'absolute', top: -6, right: -10, background: '#ff4d4f', color: '#fff',
              fontSize: 10, borderRadius: '50%', width: 16, height: 16, display: 'flex',
              alignItems: 'center', justifyContent: 'center' }}>!</span>
          )}
        </span>
      ),
      label: t('result.menuLockAnalysis'),
      children: [
        { key: 'lock-graph', icon: <ApiOutlined />, label: t('result.menuLockGraph') },
        { key: 'lock-deadlock', icon: <LockOutlined />, label: t('result.menuDeadlockDetection') },
      ],
    },
    { key: 'flame-graph', icon: <FireOutlined />, label: t('result.menuFlameGraph') },
    {
      key: 'cpu-analysis',
      icon: <ThunderboltOutlined />,
      label: t('result.menuCpuAnalysis'),
      children: [
        { key: 'cpu-inference', icon: <BulbOutlined />, label: t('result.menuCpuInference') },
        { key: 'cpu-precise', icon: <AimOutlined />, label: t('result.menuCpuPrecise') },
      ],
    },
  ];

  const findMenuItem = (items: typeof menuItems, key: string): typeof menuItems[0] | null => {
    for (const item of items) {
      if (item.key === key) return item;
      if (item.children) {
        const found = findMenuItem(item.children, key);
        if (found) return found;
      }
    }
    return null;
  };

  const handleMenuClick = ({ key }: { key: string }) => {
    const item = findMenuItem(menuItems, key);
    if (item?.children) {
      setActiveTab(item.children[0].key as Panel);
    } else {
      setActiveTab(key as Panel);
    }
  };

  const renderLoading = (loading: boolean, text: string) => {
    if (!loading) return null;
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Spin tip={text} />
      </div>
    );
  };

  if (summaryLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin tip={t('upload.analyzing')} size="large" />
      </div>
    );
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible collapsed={collapsed} onCollapse={setCollapsed}
        width={220}
        style={{ background: '#fff', boxShadow: '1px 0 0 #f0f0f0', position: 'fixed', left: 0, top: 0, height: '100vh', overflowY: 'auto', zIndex: 100 }}
        theme="light"
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ padding: collapsed ? '16px 0 14px' : '16px 20px 14px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, justifyContent: collapsed ? 'center' : 'flex-start' }}>
            <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>🔍</span>
            {!collapsed && <Title level={4} style={{ margin: 0, fontSize: 16, color: '#1a1a1a' }}>JStack Insight</Title>}
          </div>

          <Menu mode="inline" selectedKeys={[activeTab]} onClick={handleMenuClick} items={menuItems} style={{ borderRight: 0, flex: 1 }} />

          <Popover
            placement="rightBottom"
            title={t('result.tipTitle')}
            content={
              <div style={{ textAlign: 'center' }}>
                <img src="/wechat-donate.jpg" alt="赞赏码"
                  style={{ width: 180, height: 'auto', borderRadius: 8, marginBottom: 8 }} />
                <div style={{ fontSize: 13, color: '#666' }}>{t('result.tipDesc')}</div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 6, padding: '4px 8px', background: '#fff7e6', borderRadius: 4 }}>
                  {t('result.tipNotice')}
                </div>
              </div>
            }
          >
            <div
              style={{ padding: '12px 0', borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer', color: '#ff4d4f', fontSize: 13, transition: 'color 0.2s' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#cf1322'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#ff4d4f'; }}
            >
              <HeartFilled style={{ fontSize: 16, animation: 'pulse 1.2s ease-in-out infinite' }} />
              {!collapsed && <span>{t('result.tipButton')}</span>}
            </div>
          </Popover>
        </div>
      </Sider>

      <Layout style={{ marginLeft: collapsed ? 80 : 220, transition: 'margin-left 0.2s' }}>
        <div style={{ background: '#fff', padding: '0 20px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 48, flexShrink: 0, position: 'sticky', top: 0, zIndex: 99 }}>
          <Space size={12}>
            <Button icon={<ArrowLeftOutlined />} onClick={handleBack} type="primary">
              {t('result.backToUpload')}
            </Button>
            <div style={{ width: 1, height: 14, background: '#e8e8e8' }} />
            <Breadcrumb style={{ fontSize: 13 }} separator="/"
              items={[
                { title: <span style={{ color: '#999' }}>{t('result.breadcrumbAnalysisResult')}</span> },
                { title: <span style={{ color: '#1a1a1a' }}>{summary?.filename || shortUuid}</span> },
              ]}
            />
          </Space>
          <Space size={8}>
            {summary?.hasDeadlock && (
              <Tag color="red" style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, fontWeight: 500 }}>
                <BugOutlined /> {t('result.deadlockDetected')}
              </Tag>
            )}
            <Button
                icon={<ShareAltOutlined />}
                onClick={handleShare}
                type="text"
                size="small"
                style={{ color: '#666', fontSize: 13 }}
              >
                {t('result.share')}
              </Button>
            <Button
                icon={<DownloadOutlined />}
                onClick={handleExport}
                type="text"
                size="small"
                style={{ color: '#666', fontSize: 13 }}
              >
                {t('common.export')}
              </Button>
            <LanguageSwitcher mode="dropdown" size="small" />
          </Space>
        </div>

        <Content style={{ flex: 1, padding: 20, background: '#f5f5f5', overflow: 'auto', minHeight: 'calc(100vh - 48px)' }}>
          {activeTab === 'overview' && summary && (
            <>
              {renderLoading(threadsLoading, t('result.loading'))}
              {threadsData && (
                <Suspense fallback={<Spin tip={t('result.loading')}><div style={{ padding: 60 }} /></Spin>}>
                  <Overview threadState={threadsData} />
                </Suspense>
              )}
            </>
          )}

          {activeTab === 'thread-list' && (
            <>
              {renderLoading(threadsLoading, t('result.loading'))}
              {threadsData && (
                <Suspense fallback={<Spin tip={t('result.loading')}><div style={{ padding: 60 }} /></Spin>}>
                  <Threads
                    threads={threadsData.threads}
                    view="list"
                    deadlockCount={deadlockData?.detected ? deadlockData.chains.length : 0}
                    reportId={uuid}
                    threadsIdx={threadsIdx}
                    bucketCache={bucketCacheRef.current}
                    loadBucket={loadBucket}
                  />
                </Suspense>
              )}
            </>
          )}

          {activeTab === 'thread-groups' && (
            <>
              {renderLoading(threadsLoading, t('result.loading'))}
              {threadsData && (
                <Suspense fallback={<Spin tip={t('result.loading')}><div style={{ padding: 60 }} /></Spin>}>
                  <Threads threads={threadsData.threads} view="groups" stackGroups={stackGroups} />
                </Suspense>
              )}
            </>
          )}

          {activeTab === 'thread-group' && (
            <>
              {renderLoading(threadsLoading, t('result.loading'))}
              {threadsData && (
                <Suspense fallback={<Spin tip={t('result.loading')}><div style={{ padding: 60 }} /></Spin>}>
                  <ThreadGroups threadState={threadsData} />
                </Suspense>
              )}
            </>
          )}

          {activeTab === 'lock-graph' && (
            <>
              {renderLoading(lockGraphLoading, t('result.loading'))}
              {lockGraphData && threadsData && (
                <Suspense fallback={<Spin tip={t('result.loading')}><div style={{ padding: 60 }} /></Spin>}>
                  <LockGraph lockGraph={lockGraphData} threads={threadsData.threads} visible={activeTab === 'lock-graph'} />
                </Suspense>
              )}
            </>
          )}

          {activeTab === 'lock-deadlock' && (
            <>
              {renderLoading(deadlockLoading, t('result.loading'))}
              {deadlockData && threadsData && lockGraphData && (
                <Suspense fallback={<Spin tip={t('result.loading')}><div style={{ padding: 60 }} /></Spin>}>
                  <DeadlockDetail deadlockChain={deadlockData} threadState={threadsData} lockGraph={lockGraphData} />
                </Suspense>
              )}
            </>
          )}

          {activeTab === 'flame-graph' && (
            <>
              {renderLoading(flameGraphLoading, t('result.loading'))}
              {flameGraphData && (
                <Suspense fallback={<Spin tip={t('result.loading')}><div style={{ padding: 60 }} /></Spin>}>
                  <FlameGraph flameGraph={flameGraphData} visible={activeTab === 'flame-graph'} />
                </Suspense>
              )}
            </>
          )}

          {activeTab === 'cpu-inference' && (
            <>
              {renderLoading(cpuInferenceLoading, t('result.loading'))}
              {cpuInference && (
                <Suspense fallback={<Spin tip={t('result.loading')}><div style={{ padding: 60 }} /></Spin>}>
                  <CpuAnalysis
                    threads={threadsData?.threads ?? []}
                    reportId={uuid}
                    cpuTopResult={cpuTopResult}
                    setCpuTopResult={setCpuTopResult}
                    cpuTopFileList={cpuTopFileList}
                    setCpuTopFileList={setCpuTopFileList}
                    view="inference"
                    cpuInference={cpuInference}
                  />
                </Suspense>
              )}
            </>
          )}

          {activeTab === 'cpu-precise' && (
            <>
              {renderLoading(threadsLoading, t('result.loading'))}
              {threadsData && (
                <Suspense fallback={<Spin tip={t('result.loading')}><div style={{ padding: 60 }} /></Spin>}>
                  <CpuAnalysis
                    threads={threadsData.threads}
                    reportId={uuid}
                    cpuTopResult={cpuTopResult}
                    setCpuTopResult={setCpuTopResult}
                    cpuTopFileList={cpuTopFileList}
                    setCpuTopFileList={setCpuTopFileList}
                    view="precise"
                    cpuInference={cpuInference}
                  />
                </Suspense>
              )}
            </>
          )}
        </Content>
      </Layout>
    </Layout>
  );
};

export default ReportResultPage;
