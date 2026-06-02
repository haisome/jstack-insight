/**
 * 语言切换组件
 * 允许用户在中英文之间切换
 */
import React from 'react';
import { Button, Dropdown, Space } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { SUPPORTED_LANGUAGES, LANGUAGE_NAMES } from '../i18n/types';
import { getCurrentLanguage, changeLanguage } from '../i18n/i18n';

/**
 * 语言切换组件 Props
 */
interface LanguageSwitcherProps {
  /**
   * 显示模式
   * - button: 按钮模式
   * - dropdown: 下拉菜单模式（默认）
   */
  mode?: 'button' | 'dropdown';
  
  /**
   * 按钮大小
   */
  size?: 'small' | 'middle' | 'large';
}

/**
 * 语言切换组件
 */
const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({
  mode = 'dropdown',
  size = 'small',
}) => {
  // 构建下拉菜单项
  const menuItems: MenuProps['items'] = SUPPORTED_LANGUAGES.map(lng => ({
    key: lng,
    label: LANGUAGE_NAMES[lng as keyof typeof LANGUAGE_NAMES],
    icon: getCurrentLanguage() === lng ? '✓' : '',
    onClick: () => changeLanguage(lng),
  }));

  // 下拉菜单模式
  if (mode === 'dropdown') {
    return (
      <Dropdown menu={{ items: menuItems }} placement="bottomRight">
        <Button
          icon={<GlobalOutlined />}
          size={size}
          type="text"
        >
          {LANGUAGE_NAMES[getCurrentLanguage() as keyof typeof LANGUAGE_NAMES]}
        </Button>
      </Dropdown>
    );
  }

  // 按钮组模式
  return (
    <Space size={4}>
      {SUPPORTED_LANGUAGES.map(lng => (
        <Button
          key={lng}
          size={size}
          type={getCurrentLanguage() === lng ? 'primary' : 'default'}
          onClick={() => changeLanguage(lng)}
        >
          {LANGUAGE_NAMES[lng as keyof typeof LANGUAGE_NAMES]}
        </Button>
      ))}
    </Space>
  );
};

export default LanguageSwitcher;
