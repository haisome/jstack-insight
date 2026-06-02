/**
 * i18n 类型定义
 * 从翻译资源自动生成类型，提供类型安全和自动补全
 */
import { zhCN } from './resources/zh-CN';
import { en } from './resources/en';

/**
 * 所有支持的语言资源类型
 * 从实际翻译资源推导，确保类型同步
 */
export type Resources = {
  'zh-CN': typeof zhCN;
  'en': typeof en;
};

/**
 * 默认语言
 */
export const DEFAULT_LANGUAGE = 'zh-CN';

/**
 * 支持的语言列表
 */
export const SUPPORTED_LANGUAGES = ['zh-CN', 'en'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * 语言显示名称映射
 */
export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  'zh-CN': '中文',
  'en': 'English',
};
