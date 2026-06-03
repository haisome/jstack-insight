import React, { useState, useCallback } from 'react';
import {
  Upload,
  Button,
  Typography,
  Space,
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
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import { uploadAndAnalyze } from '../../services/api';
import type { AnalysisResultVO } from '../../types';

const { Dragger } = Upload;
const { Title, Paragraph, Text } = Typography;

/** 命令 demo（与 CPU 分析页保持一致） */
const CMD_COMBINED = 'top -H -p <pid> -n 1 -b > top_threads.txt && jstack -l <pid> > jstack.txt';
const CMD_JSTACK_ONLY = 'jstack -l <pid> > jstack.txt';

interface UploadPageProps {
  onResult: (result: AnalysisResultVO, rawFile: File | null) => void;
}

const UploadPage: React.FC<UploadPageProps> = ({ onResult }) => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  const handleAnalyze = async () => {
    if (fileList.length === 0) {
      message.warning(t('upload.warningNoFile'));
      return;
    }

    const rawFile = fileList[0].originFileObj;
    if (!rawFile) {
      message.error(t('upload.errorFileObject'));
      return;
    }

    setLoading(true);
    try {
      const result = await uploadAndAnalyze(rawFile);
      message.success(t('upload.successAnalyzed'));
      onResult(result, rawFile);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('upload.errorAnalyzeFailed');
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
        position: 'relative',
      }}
    >
      {/* 语言切换 - 右上角 */}
      <div style={{ position: 'absolute', top: 16, right: 16 }}>
        <LanguageSwitcher mode="dropdown" size="small" />
      </div>

      {/* 标题区 */}
      <Space direction="vertical" align="center" style={{ marginBottom: 48 }}>
        <Title level={1} style={{ margin: 0, color: '#1677ff' }}>
          🔍 {t('common.appName')}
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
          {t('upload.subtitle')}
          <br />
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('upload.features')}
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
        <Spin spinning={loading} tip={t('upload.analyzing')}>
          <Dragger {...draggerProps} style={{ borderRadius: 12 }}>
            <p className="ant-upload-drag-icon">
              <InboxOutlined style={{ color: '#1677ff', fontSize: 48 }} />
            </p>
            <p
              className="ant-upload-text"
              style={{ fontSize: 16, fontWeight: 500 }}
            >
              {t('upload.draggerText')}
            </p>
            <p className="ant-upload-hint" style={{ color: '#999' }}>
              {t('upload.draggerHint')}
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
            {t('upload.analyzeButton')}
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
              {t('upload.commandTitle')}
            </div>
            <div>
              <span style={{ color: '#dcdcaa' }}>{CMD_COMBINED}</span>
            </div>
          </div>
          <Space style={{ marginTop: 10, alignItems: 'center' }}>
            <Popover
              content={
                <div style={{ maxWidth: 520, fontSize: 13 }}>
                  <p style={{ margin: '0 0 6px', fontWeight: 600 }}>{t('upload.howToGetFile')}</p>
                  <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
                    <li>
                      {t('upload.step1')}<code>jps -l</code> 或 <code>ps -ef | grep java</code>
                    </li>
                    <li>
                      {t('upload.step2')}<br />
                      <code style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: 4 }}>{CMD_JSTACK_ONLY}</code>
                    </li>
                    <li>
                      {t('upload.step3')}<br />
                      <code style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>{CMD_COMBINED}</code>
                    </li>
                    <li>{t('upload.step4')}</li>
                  </ol>
                  <p style={{ margin: '8px 0 0', color: '#999', fontSize: 12 }}>
                    {t('upload.tip')}
                  </p>
                </div>
              }
              title={t('upload.commandHelp')}
              placement="topRight"
              trigger="hover"
            >
              <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer', fontSize: 13 }} />
            </Popover>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('upload.privacyNote')}
            </Text>
          </Space>
        </div>
      </div>

      {/* 底部链接 */}
      <Space style={{ marginTop: 32, color: '#999' }}>
        <GithubOutlined />
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('common.appName')} · {t('common.appDescription')}
        </Text>
      </Space>
    </div>
  );
};

export default UploadPage;
