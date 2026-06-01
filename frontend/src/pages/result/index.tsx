import React, { useState } from 'react';
import { Layout, Menu, Button, Space, Typography, Tag, Breadcrumb } from 'antd';
import type { UploadFile } from 'antd';
import {
  HomeOutlined,
  UnorderedListOutlined,
  ApiOutlined,
  FireOutlined,
  DashboardOutlined,
  ArrowLeftOutlined,
  BugOutlined,
  FileSearchOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ClusterOutlined,
  LockOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import Overview from './Overview';
import Threads from './Threads';
import LockGraph from './LockGraph';
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

/** 菜单 key → 面包屑名称 */
const MENU_BREADCRUMB: Record<string, string> = {
  overview: '概览',
  'thread-analysis': '线程分析',
  'thread-list': '线程列表',
  'thread-groups': '相同堆栈分析',
  'lock-analysis': '锁分析',
  'lock-graph': '锁竞争图',
  'lock-deadlock': '死锁检测',
  'flame-graph': '火焰图',
  'cpu-analysis': 'CPU 分析',
  'cpu-inference': 'CPU 线程推测',
  'cpu-precise': '精准 CPU 采集',
};

const ResultPage: React.FC<ResultPageProps> = ({ result, jstackRawFile, onBack }) => {
  const [activeTab, setActiveTab] = useState('overview');
  const [collapsed, setCollapsed] = useState(false);
  // CPU 分析状态：提升到 ResultPage 层级，切换 tab 时不丢失
  const [cpuTopResult, setCpuTopResult] = useState<TopCpuVO | null>(null);
  const [cpuTopFileList, setCpuTopFileList] = useState<UploadFile[]>([]);
  const { threadState, lockGraph, flameGraph, deadlockChain } = result;

  // 根据 activeTab 渲染对应面板（只渲染当前面板，切换时重新挂载）
  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return <Overview threadState={threadState} />;
      case 'thread-list':
        return <Threads threads={threadState.threads} view="list" />;
      case 'thread-groups':
        return <Threads threads={threadState.threads} view="groups" />;
      case 'lock-graph':
        return <LockGraph lockGraph={lockGraph} />;
      case 'lock-deadlock':
        return <LockGraph lockGraph={lockGraph} />;
      case 'flame-graph':
        return <FlameGraph flameGraph={flameGraph} />;
      case 'cpu-inference':
        return (
          <CpuAnalysis
            threads={threadState.threads}
            jstackRawFile={jstackRawFile}
            cpuTopResult={cpuTopResult}
            setCpuTopResult={setCpuTopResult}
            cpuTopFileList={cpuTopFileList}
            setCpuTopFileList={setCpuTopFileList}
            view="inference"
          />
        );
      case 'cpu-precise':
        return (
          <CpuAnalysis
            threads={threadState.threads}
            jstackRawFile={jstackRawFile}
            cpuTopResult={cpuTopResult}
            setCpuTopResult={setCpuTopResult}
            cpuTopFileList={cpuTopFileList}
            setCpuTopFileList={setCpuTopFileList}
            view="precise"
          />
        );
      default:
        return <Overview threadState={threadState} />;
    }
  };

  // 菜单项（带角标 + 子菜单）
  const menuItems = [
    {
      key: 'overview',
      icon: <HomeOutlined />,
      label: '概览',
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
      label: '线程分析',
      children: [
        {
          key: 'thread-list',
          icon: <UnorderedListOutlined />,
          label: '线程列表',
        },
        {
          key: 'thread-groups',
          icon: <ClusterOutlined />,
          label: '相同堆栈分析',
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
      label: '锁分析',
      children: [
        {
          key: 'lock-graph',
          icon: <ApiOutlined />,
          label: '锁竞争图',
        },
        {
          key: 'lock-deadlock',
          icon: <LockOutlined />,
          label: '死锁检测',
        },
      ],
    },
    // 火焰图 - 提升到顶级
    {
      key: 'flame-graph',
      icon: <FireOutlined />,
      label: '火焰图',
    },
    // CPU 分析 - 父节点
    {
      key: 'cpu-analysis',
      icon: <ThunderboltOutlined />,
      label: 'CPU 分析',
      children: [
        {
          key: 'cpu-inference',
          icon: <ThunderboltOutlined />,
          label: 'CPU 线程推测',
        },
        {
          key: 'cpu-precise',
          icon: <DashboardOutlined />,
          label: '精准 CPU 采集',
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
  const getBreadcrumbItems = () => {
    const items: { title: React.ReactNode }[] = [
      { title: <span style={{ color: '#999' }}>分析结果</span> },
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
        items.push({ title: <span style={{ color: key === activeTab ? '#1a1a1a' : '#999' }}>{MENU_BREADCRUMB[key] || key}</span> });
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
          <FileSearchOutlined style={{ fontSize: 20, color: '#1677ff', flexShrink: 0 }} />
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
              重新上传
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
                <BugOutlined /> {deadlockChain.chains.length} 组死锁
              </Tag>
            )}
            {lockGraph.hasDeadlock && (
              <Tag color="orange" style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, fontWeight: 500 }}>
                存在锁竞争
              </Tag>
            )}
          </Space>
        </div>

        {/* 主内容 */}
        <Content
          style={{
            flex: 1,
            padding: 20,
            background: '#f5f5f5',
            overflow: 'auto',
            minHeight: 'calc(100vh - 48px)',
          }}
        >
          {renderTabContent()}
        </Content>
      </Layout>
    </Layout>
  );
};

export default ResultPage;
