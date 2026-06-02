/**
 * i18n 配置文件
 * 初始化 i18next，配置语言和翻译资源
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LANGUAGE } from './types';

// 导入翻译资源
import { zhCN } from './resources/zh-CN';
import { en } from './resources/en';

/**
 * 翻译资源映射
 * 所有资源合并到默认的 translation 命名空间，避免 TypeScript 4.9.5 与 react-i18next@17 的类型兼容问题
 */
const resources = {
  'zh-CN': {
    translation: zhCN,
  },
  'en': {
    translation: en,
  },
};

/**
 * 初始化 i18n
 */
i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: localStorage.getItem('i18nextLng') || DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,

    // 调试模式（开发时可以开启）
    debug: process.env.NODE_ENV === 'development',

    // 插值配置
    interpolation: {
      escapeValue: false, // React 已经做了 XSS 防护
    },

    // React 配置
    react: {
      useSuspense: false, // 禁用 Suspense，避免需要包裹 Suspense 组件
    },
  })
  .then(() => {
    console.log('[i18n] 初始化成功，当前语言:', (i18n as any).language);
  })
  .catch((err: any) => {
    console.error('[i18n] 初始化失败:', err);
  });

/**
 * 切换语言
 */
export const changeLanguage = (lng: string) => {
  (i18n as any).changeLanguage(lng);
  localStorage.setItem('i18nextLng', lng);
  
  // 更新 Ant Design 语言（如果需要）
  // 这里可以动态加载 antd 的语言包
};

/**
 * 获取当前语言
 */
export const getCurrentLanguage = (): string => {
  return (i18n as any).language || DEFAULT_LANGUAGE;
};

export default i18n;
