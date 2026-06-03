import React, { useState, useEffect } from 'react';
import { ConfigProvider, App as AntApp, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import UploadPage from './pages/upload';
import ResultPage from './pages/result';
import type { AnalysisResultVO } from './types';

// 导入 i18n 配置（确保初始化）
import './i18n/i18n';
import { useTranslation } from 'react-i18next';

/**
 * 获取 Ant Design 语言包
 */
const getAntdLocale = (lng: string) => {
  switch (lng) {
    case 'en':
      return enUS;
    case 'zh-CN':
    default:
      return zhCN;
  }
};

/**
 * JStack Insight 前端根组件
 *
 * <p>使用 Ant Design 5 的 ConfigProvider + App 组件作为根容器。
 * App 组件提供全局的 message/notification/modal 上下文。
 */
const App: React.FC = () => {
  const [analysisResult, setAnalysisResult] = useState<{
    result: AnalysisResultVO;
    rawFile: File | null;
  } | null>(null);

  // 使用 useTranslation hook 获取 i18n 实例
  const { i18n } = useTranslation();
  
  // 监听语言变化，更新 antd 语言包
  const [antdLocale, setAntdLocale] = useState(getAntdLocale(i18n.language || 'zh-CN'));

  useEffect(() => {
    // 监听 i18next 语言变化事件
    const handleLanguageChanged = (lng: string) => {
      setAntdLocale(getAntdLocale(lng));
    };

    // 初始化时设置当前语言
    handleLanguageChanged(i18n.language || 'zh-CN');
    i18n.on('languageChanged', handleLanguageChanged);

    return () => {
      i18n.off('languageChanged', handleLanguageChanged);
    };
  }, [i18n]);

  // 未有结果 → 显示上传页；有结果 → 显示结果页
  return (
    <ConfigProvider
      locale={antdLocale}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 8,
          fontSize: 14,
        },
        components: {
          Card: {
            borderRadiusLG: 12,
          },
          Table: {
            borderRadius: 8,
          },
        },
      }}
    >
      <AntApp>
        {analysisResult ? (
          <ResultPage
            result={analysisResult.result}
            jstackRawFile={analysisResult.rawFile}
            onBack={() => setAnalysisResult(null)}
          />
        ) : (
          <UploadPage onResult={(result, rawFile) => setAnalysisResult({ result, rawFile })} />
        )}
      </AntApp>
    </ConfigProvider>
  );
};

export default App;
