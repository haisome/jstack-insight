import React, { useState, useCallback } from 'react';
import {
  Upload,
  Button,
  Typography,
  Space,
  Alert,
  Spin,
  App,
  Popover,
} from 'antd';
import {
  InboxOutlined,
  SearchOutlined,
  GithubOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import type { UploadFile, UploadProps } from 'antd';
import { uploadAndAnalyze } from '../../services/api';
import type { AnalysisResultVO } from '../../types';

const { Dragger } = Upload;
const { Title, Paragraph, Text } = Typography;

/** 命令 demo（与 CPU 分析页保持一致） */
const CMD_COMBINED = 'top -H -p <pid> -n 1 -b > top_threads.txt && jstack -l <pid> > jstack.txt';
const CMD_JSTACK_ONLY = 'jstack -l <pid> > jstack.txt';

/** 命令帮助 Popover 内容 */
const COMMAND_HELP = (
  <div style={{ maxWidth: 520, fontSize: 13 }}>
    <p style={{ margin: '0 0 6px', fontWeight: 600 }}>如何获取分析文件？</p>
    <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
      <li>
        找到 Java 进程 PID：<code>jps -l</code> 或 <code>ps -ef | grep java</code>
      </li>
      <li>
        生成 jstack 文件：<br />
        <code style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: 4 }}>{CMD_JSTACK_ONLY}</code>
      </li>
      <li>
        （可选）同时采集 top 线程 CPU 数据：<br />
        <code style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>{CMD_COMBINED}</code>
      </li>
      <li>上传生成的 .txt 文件到本工具进行分析</li>
    </ol>
    <p style={{ margin: '8px 0 0', color: '#999', fontSize: 12 }}>
      提示：top 文件可在「CPU 分析」页面上传，用于精确关联线程 CPU 占用率。
    </p>
  </div>
);

interface UploadPageProps {
  onResult: (result: AnalysisResultVO, rawFile: File | null) => void;
}

const UploadPage: React.FC<UploadPageProps> = ({ onResult }) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  const handleAnalyze = async () => {
    if (fileList.length === 0) {
      message.warning('请先上传 jstack 文件');
      return;
    }

    const rawFile = fileList[0].originFileObj;
    if (!rawFile) {
      message.error('文件对象异常，请重新选择文件');
      return;
    }

    setLoading(true);
    try {
      const result = await uploadAndAnalyze(rawFile);
      message.success('分析完成！');
      onResult(result, rawFile);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '分析失败，请重试';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const draggerProps: UploadProps = {
    name: 'file',
    multiple: false,
    accept: '.txt',
    fileList,
    // 阻止自动上传，由「开始分析」按钮手动触发
    beforeUpload: () => false,
    onChange: (info) => {
      // 只保留最后一个文件
      const latest = info.fileList.slice(-1);
      setFileList(latest);
    },
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #f0f4ff 0%, #e8f4f8 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
      }}
    >
      {/* 标题区 */}
      <Space direction="vertical" align="center" style={{ marginBottom: 48 }}>
        <Title level={1} style={{ margin: 0, color: '#1677ff' }}>
          🔍 JStack Insight
        </Title>
        <Paragraph
          style={{
            fontSize: 15,
            color: '#555',
            textAlign: 'center',
            maxWidth: 500,
            margin: 0,
            lineHeight: 1.6,
          }}
        >
          一键上传 JStack 线程转储，快速定位死锁、锁竞争与性能瓶颈
          <br />
          <Text type="secondary" style={{ fontSize: 13 }}>
            支撑多种分析模式：线程组、锁竞争图、死锁检测、火焰图、CPU线程推测
          </Text>
        </Paragraph>
      </Space>

      {/* 上传区 */}
      <div
        style={{
          width: '100%',
          maxWidth: 640,
          background: '#fff',
          borderRadius: 16,
          padding: 32,
          boxShadow: '0 8px 40px rgba(0,0,0,0.1)',
        }}
      >
        <Spin spinning={loading} tip="分析中，请稍候...">
          <Dragger {...draggerProps} style={{ borderRadius: 12 }}>
            <p className="ant-upload-drag-icon">
              <InboxOutlined style={{ color: '#1677ff', fontSize: 48 }} />
            </p>
            <p
              className="ant-upload-text"
              style={{ fontSize: 16, fontWeight: 500 }}
            >
              点击或拖拽 jstack 文件到此处
            </p>
            <p className="ant-upload-hint" style={{ color: '#999' }}>
              仅支持 .txt 格式，文件大小 ≤ 50MB
            </p>
          </Dragger>

          <Button
            type="primary"
            size="large"
            icon={<SearchOutlined />}
            onClick={handleAnalyze}
            loading={loading}
            disabled={fileList.length === 0}
            block
            style={{ marginTop: 24, height: 48, fontSize: 16, borderRadius: 8 }}
          >
            开始分析
          </Button>
        </Spin>

        {/* 命令帮助 + 隐私说明 */}
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              background: '#f6f8fa',
              borderRadius: 8,
              padding: '12px 16px',
              fontSize: 12,
              fontFamily: "'Fira Code','Consolas','Courier New',monospace",
              lineHeight: 2,
              color: '#333',
            }}
          >
            <div style={{ fontFamily: "'Inter',sans-serif", color: '#999', marginBottom: 4 }}>
              <QuestionCircleOutlined style={{ marginRight: 4 }} />
              采集命令（将 {'<pid>'} 替换为 Java 进程 PID）：
            </div>
            <div>
              <span style={{ color: '#dcdcaa' }}>{CMD_COMBINED}</span>
            </div>
          </div>
          <Space style={{ marginTop: 10, alignItems: 'center' }}>
            <Popover content={COMMAND_HELP} title="命令帮助" placement="topRight" trigger="hover">
              <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer', fontSize: 13 }} />
            </Popover>
            <Text type="secondary" style={{ fontSize: 12 }}>
              文件不会持久化存储
            </Text>
          </Space>
        </div>
      </div>

      {/* 底部链接 */}
      <Space style={{ marginTop: 32, color: '#999' }}>
        <GithubOutlined />
        <Text type="secondary" style={{ fontSize: 12 }}>
          JStack Insight · JVM Thread Dump Analyzer
        </Text>
      </Space>
    </div>
  );
};

export default UploadPage;
