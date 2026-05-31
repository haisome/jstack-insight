import React, { useState } from 'react';
import { Menu, Button, Space, Typography, Tag, Breadcrumb } from 'antd';
import {
  HomeOutlined,
  UnorderedListOutlined,
  ApiOutlined,
  FireOutlined,
  DashboardOutlined,
  ArrowLeftOutlined,
  BugOutlined,
  FileSearchOutlined,
} from '@ant-design/icons';
import Overview from './Overview';
import Threads from './Threads';
import LockGraph from './LockGraph';
import FlameGraph from './FlameGraph';
import CpuAnalysis from './CpuAnalysis';
import type { AnalysisResultVO } from '../../types';

const { Title } = Typography;

interface ResultPageProps {
  result: AnalysisResultVO;
  jstackRawFile?: File | null;
  onBack: () => void;
}

const TAB_NAMES: Record<string, string> = {
  overview: '概览',
  threads: '线程列表',
  lockGraph: '锁竞争图',
  flameGraph: '火焰图',
  cpu: 'CPU 分析',
};

const ResultPage: React.FC<ResultPageProps> = ({ result, jstackRawFile, onBack }) => {
  const [activeTab, setActiveTab] = useState('overview');
  const { threadState, lockGraph, flameGraph, deadlockChain } = result;

  const renderContent = () => {
    switch (activeTab) {
      case 'overview':
        return <Overview threadState={threadState} />;
      case 'threads':
        return <Threads threads={threadState.threads} />;
      case 'lockGraph':
        return <LockGraph lockGraph={lockGraph} />;
      case 'flameGraph':
        return <FlameGraph flameGraph={flameGraph} />;
      case 'cpu':
        return <CpuAnalysis threads={threadState.threads} jstackRawFile={jstackRawFile} />;
      default:
        return <Overview threadState={threadState} />;
    }
  };

  // 菜单项（带角标）
  const menuItems = [
    {
      key: 'overview',
      icon: <HomeOutlined />,
      label: '概览',
    },
    {
      key: 'threads',
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
      label: '线程列表',
    },
    {
      key: 'lockGraph',
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
      label: '锁竞争图',
    },
    {
      key: 'flameGraph',
      icon: <FireOutlined />,
      label: '火焰图',
    },
    {
      key: 'cpu',
      icon: <DashboardOutlined />,
      label: 'CPU 分析',
    },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* 左侧菜单 */}
      <div
        style={{
          width: 200,
          background: '#fff',
          boxShadow: '1px 0 0 #f0f0f0',
          position: 'fixed',
          left: 0,
          top: 0,
          height: '100vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 100,
        }}
      >
        {/* Logo / 标题 */}
        <div
          style={{
            padding: '16px 20px 14px',
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
          }}
        >
          <FileSearchOutlined style={{ fontSize: 20, color: '#1677ff' }} />
          <Title level={4} style={{ margin: 0, fontSize: 16, color: '#1a1a1a' }}>
            JStack Insight
          </Title>
        </div>

        {/* 导航菜单 */}
        <Menu
          mode="inline"
          selectedKeys={[activeTab]}
          onClick={({ key }) => setActiveTab(key)}
          items={menuItems}
          style={{ borderRight: 0, flex: 1 }}
        />
      </div>

      {/* 右侧内容区 */}
      <div style={{ marginLeft: 200, flex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
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
            >
              <Breadcrumb.Item>
                <span style={{ color: '#999' }}>分析结果</span>
              </Breadcrumb.Item>
              <Breadcrumb.Item>
                <span style={{ color: '#1a1a1a', fontWeight: 600 }}>{TAB_NAMES[activeTab]}</span>
              </Breadcrumb.Item>
            </Breadcrumb>
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
            <Tag color="blue" style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, fontWeight: 500 }}>
              {threadState.totalThreads} 线程
            </Tag>
          </Space>
        </div>

        {/* 主内容 */}
        <div
          style={{
            flex: 1,
            padding: 20,
            background: '#f5f5f5',
            overflow: 'auto',
          }}
        >
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default ResultPage;
