import React, { useState } from 'react';
import { ConfigProvider, App as AntApp, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import UploadPage from './pages/upload';
import ResultPage from './pages/result';
import type { AnalysisResultVO } from './types';

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

  // 未有结果 → 显示上传页；有结果 → 显示结果页
  return (
    <ConfigProvider
      locale={zhCN}
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
