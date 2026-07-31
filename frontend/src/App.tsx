import React, { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { ConfigProvider, App as AntApp, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import UploadPage from './pages/upload';
import ReportResultPage from './pages/result/ReportResultPage';

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

const App: React.FC = () => {
  const { i18n } = useTranslation();
  const [antdLocale, setAntdLocale] = useState(getAntdLocale(i18n.language || 'zh-CN'));

  useEffect(() => {
    const handleLanguageChanged = (lng: string) => {
      setAntdLocale(getAntdLocale(lng));
    };
    handleLanguageChanged(i18n.language || 'zh-CN');
    i18n.on('languageChanged', handleLanguageChanged);
    return () => {
      i18n.off('languageChanged', handleLanguageChanged);
    };
  }, [i18n]);

  return (
    <ConfigProvider
      locale={antdLocale}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: { colorPrimary: '#1677ff', borderRadius: 8, fontSize: 14 },
        components: { Card: { borderRadiusLG: 12 }, Table: { borderRadius: 8 } },
      }}
    >
      <AntApp>
        <Routes>
          <Route path="/" element={<UploadPage />} />
          <Route path="/report/:uuid" element={<ReportResultPage />} />
        </Routes>
      </AntApp>
    </ConfigProvider>
  );
};

export default App;
