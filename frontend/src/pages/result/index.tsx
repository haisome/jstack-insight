import React, { useState } from 'react';
import { Layout, Menu, Button, Space, Typography, Tag, Breadcrumb } from 'antd';
import type { UploadFile } from 'antd';
import {
  HomeOutlined,
  UnorderedListOutlined,
  ApiOutlined,
  FireOutlined,
  ArrowLeftOutlined,
  BugOutlined,
  ClusterOutlined,
  LockOutlined,
  ThunderboltOutlined,
  CopyOutlined,
  BulbOutlined,
  AimOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import Overview from './Overview';
import Threads from './Threads';
import LockGraph from './LockGraph';
import DeadlockDetail from './DeadlockDetail';
import ThreadGroups from './ThreadGroups';
import FlameGraph from './FlameGraph';
import CpuAnalysis from './CpuAnalysis';
import type { AnalysisResultVO, TopCpuVO } from '../../types';

const { Sider, Content } = Layout;
const { Title } = Typography;

interface ResultPageProps {
  result: AnalysisResultVO;
  jstackRawFile?: File | null;
  onBack: () => void;
}

const ResultPage: React.FC<ResultPageProps> = ({ result, jstackRawFile, onBack }) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('overview');
  const [collapsed, setCollapsed] = useState(false);
  // CPU 分析状态：提升到 ResultPage 层级，切换 tab 时不丢失
  const [cpuTopResult, setCpuTopResult] = useState<TopCpuVO | null>(null);
  const [cpuTopFileList, setCpuTopFileList] = useState<UploadFile[]>([]);
  const { threadState, lockGraph, flameGraph, deadlockChain } = result;

  // 全部面板同时挂载，只用 CSS display 切换可见性，避免状态丢失
  // D3 组件通过 visible prop 暂停后台仿真，防止性能浪费
  const panelStyle = (key: string): React.CSSProperties => ({
    display: activeTab === key ? 'block' : 'none',
  });

  // 菜单项（带角标 + 子菜单）- 使用 t() 函数
  const menuItems = [
    {
      key: 'overview',
      icon: <HomeOutlined />,
      label: t('result.menuOverview'),
    },
    {
      key: 'thread-analysis',
      icon: (
        <span style={{ position: 'relative' }}>
          <UnorderedListOutlined />
          {threadState.deadlockCount > 0 && (
            <span
              style={{
                position: 'absolute',
                top: -6,
                right: -10,
                background: '#ff4d4f',
                color: '#fff',
                fontSize: 10,
                borderRadius: '50%',
                width: 16,
                height: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
              }}
            >
              {threadState.deadlockCount}
            </span>
          )}
        </span>
      ),
      label: t('result.menuThreadAnalysis'),
      children: [
        {
          key: 'thread-list',
          icon: <UnorderedListOutlined />,
          label: t('result.menuThreadList'),
        },
        {
          key: 'thread-group',
          icon: <ClusterOutlined />,
          label: t('result.menuThreadGroup'),
        },
        {
          key: 'thread-groups',
          icon: <CopyOutlined />,
          label: t('result.menuSameStackAnalysis'),
        },
      ],
    },
    {
      key: 'lock-analysis',
      icon: (
        <span style={{ position: 'relative' }}>
          <ApiOutlined />
          {lockGraph.hasDeadlock && (
            <span
              style={{
                position: 'absolute',
                top: -6,
                right: -10,
                background: '#ff4d4f',
                color: '#fff',
                fontSize: 10,
                borderRadius: '50%',
                width: 16,
                height: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
              }}
            >
              !
            </span>
          )}
        </span>
      ),
      label: t('result.menuLockAnalysis'),
      children: [
        {
          key: 'lock-graph',
          icon: <ApiOutlined />,
          label: t('result.menuLockGraph'),
        },
        {
          key: 'lock-deadlock',
          icon: <LockOutlined />,
          label: t('result.menuDeadlockDetection'),
        },
      ],
    },
    // 火焰图 - 提升到顶级
    {
      key: 'flame-graph',
      icon: <FireOutlined />,
      label: t('result.menuFlameGraph'),
    },
    // CPU 分析 - 父节点
    {
      key: 'cpu-analysis',
      icon: <ThunderboltOutlined />,
      label: t('result.menuCpuAnalysis'),
      children: [
        {
          key: 'cpu-inference',
          icon: <BulbOutlined />,
          label: t('result.menuCpuInference'),
        },
        {
          key: 'cpu-precise',
          icon: <AimOutlined />,
          label: t('result.menuCpuPrecise'),
        },
      ],
    },
  ];

  // 辅助：根据 key 查找菜单项
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

  // 菜单点击处理
  const handleMenuClick = ({ key }: { key: string }) => {
    const item = findMenuItem(menuItems, key);
    if (item?.children) {
      // 父级菜单：导航到第一个子项
      setActiveTab(item.children[0].key);
    } else {
      setActiveTab(key);
    }
  };

  // 面包屑：找到当前 activeTab 对应的面包屑路径
  // 菜单 key → 面包屑名称（使用 t() 函数）
  const getMenuBreadcrumbName = (key: string): string => {
    const breadcrumbMap: Record<string, string> = {
      overview: t('result.menuOverview'),
      'thread-analysis': t('result.menuThreadAnalysis'),
      'thread-list': t('result.menuThreadList'),
      'thread-groups': t('result.menuSameStackAnalysis'),
      'thread-group': t('result.menuThreadGroup'),
      'lock-analysis': t('result.menuLockAnalysis'),
      'lock-graph': t('result.menuLockGraph'),
      'lock-deadlock': t('result.menuDeadlockDetection'),
      'flame-graph': t('result.menuFlameGraph'),
      'cpu-analysis': t('result.menuCpuAnalysis'),
      'cpu-inference': t('result.menuCpuInference'),
      'cpu-precise': t('result.menuCpuPrecise'),
    };
    return breadcrumbMap[key] || key;
  };

  const getBreadcrumbItems = () => {
    const items: { title: React.ReactNode }[] = [
      { title: <span style={{ color: '#999' }}>{t('result.breadcrumbAnalysisResult')}</span> },
    ];
    // 找到当前 tab 在菜单树中的路径
    const findPath = (items: typeof menuItems, targetKey: string, path: string[] = []): string[] | null => {
      for (const item of items) {
        if (item.key === targetKey) return [...path, item.key];
        if (item.children) {
          const found = findPath(item.children, targetKey, [...path, item.key]);
          if (found) return found;
        }
      }
      return null;
    };
    const path = findPath(menuItems, activeTab);
    if (path) {
      path.forEach(key => {
        items.push({ title: <span style={{ color: key === activeTab ? '#1a1a1a' : '#999' }}>{getMenuBreadcrumbName(key)}</span> });
      });
    }
    return items;
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* 左侧侧边栏 */}
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={220}
        style={{
          background: '#fff',
          boxShadow: '1px 0 0 #f0f0f0',
          position: 'fixed',
          left: 0,
          top: 0,
          height: '100vh',
          overflowY: 'auto',
          zIndex: 100,
        }}
        theme="light"
      >
        {/* Logo / 标题 */}
        <div
          style={{
            padding: collapsed ? '16px 0 14px' : '16px 20px 14px',
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}
        >
          <img src="/logo.png" alt="JStack Insight" style={{ width: 28, height: 24.5, flexShrink: 0 }} />
          {!collapsed && (
            <Title level={4} style={{ margin: 0, fontSize: 16, color: '#1a1a1a' }}>
              JStack Insight
            </Title>
          )}
        </div>

        {/* 导航菜单 */}
        <Menu
          mode="inline"
          selectedKeys={[activeTab]}
          onClick={handleMenuClick}
          items={menuItems}
          style={{ borderRight: 0 }}
        />
      </Sider>

      {/* 右侧内容区 */}
      <Layout style={{ marginLeft: collapsed ? 80 : 220, transition: 'margin-left 0.2s' }}>
        {/* 顶部栏 */}
        <div
          style={{
            background: '#fff',
            padding: '0 20px',
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 48,
            flexShrink: 0,
            position: 'sticky',
            top: 0,
            zIndex: 99,
          }}
        >
          <Space size={12}>
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={onBack}
              type="text"
              size="small"
              style={{ color: '#666', fontSize: 13 }}
            >
              {t('result.backToUpload')}
            </Button>
            <div
              style={{
                width: 1,
                height: 14,
                background: '#e8e8e8',
                display: 'inline-block',
              }}
            />
            <Breadcrumb
              style={{ fontSize: 13 }}
              separator="/"
              items={getBreadcrumbItems()}
            />
          </Space>
          <Space size={8}>
            {deadlockChain.detected && (
              <Tag color="red" style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, fontWeight: 500 }}>
                <BugOutlined /> {t('result.deadlockCount', { count: deadlockChain.chains.length })}
              </Tag>
            )}
            <LanguageSwitcher mode="dropdown" size="small" />
          </Space>
        </div>

        {/* 主内容 — 全部面板保持挂载，CSS display 控制可见性，状态不丢失 */}
        <Content
          style={{
            flex: 1,
            padding: 20,
            background: '#f5f5f5',
            overflow: 'auto',
            minHeight: 'calc(100vh - 48px)',
          }}
        >
          <div style={panelStyle('overview')}>
            <Overview threadState={threadState} />
          </div>
          <div style={panelStyle('thread-list')}>
            <Threads threads={threadState.threads} view="list" deadlockCount={deadlockChain.detected ? deadlockChain.chains.length : 0} />
          </div>
          <div style={panelStyle('thread-groups')}>
            <Threads threads={threadState.threads} view="groups" deadlockCount={deadlockChain.detected ? deadlockChain.chains.length : 0} />
          </div>
          <div style={panelStyle('thread-group')}>
            <ThreadGroups threadState={threadState} />
          </div>
          <div style={panelStyle('lock-graph')}>
            <LockGraph lockGraph={lockGraph} threads={threadState.threads} visible={activeTab === 'lock-graph'} />
          </div>
          <div style={panelStyle('lock-deadlock')}>
            <DeadlockDetail deadlockChain={deadlockChain} threadState={threadState} lockGraph={lockGraph} />
          </div>
          <div style={panelStyle('flame-graph')}>
            <FlameGraph flameGraph={flameGraph} visible={activeTab === 'flame-graph'} />
          </div>
          <div style={panelStyle('cpu-inference')}>
            <CpuAnalysis
              threads={threadState.threads}
              jstackRawFile={jstackRawFile}
              cpuTopResult={cpuTopResult}
              setCpuTopResult={setCpuTopResult}
              cpuTopFileList={cpuTopFileList}
              setCpuTopFileList={setCpuTopFileList}
              view="inference"
            />
          </div>
          <div style={panelStyle('cpu-precise')}>
            <CpuAnalysis
              threads={threadState.threads}
              jstackRawFile={jstackRawFile}
              cpuTopResult={cpuTopResult}
              setCpuTopResult={setCpuTopResult}
              cpuTopFileList={cpuTopFileList}
              setCpuTopFileList={setCpuTopFileList}
              view="precise"
            />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
};

export default ResultPage;
