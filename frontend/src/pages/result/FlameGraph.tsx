/* eslint-disable */
import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import { Card, Typography, Empty, Popover, Input, message } from 'antd';
import { QuestionCircleOutlined, SearchOutlined, CopyOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { FlameGraphVO, FlameNode } from '../../types';

const { Title } = Typography;

interface FlameGraphProps {
  flameGraph: FlameGraphVO;
  /** 当前 tab 是否可见，保留以备将来使用 */
  visible?: boolean;
}

/** 着色方案：按 colorCategory 映射具体颜色 */
const COLOR_MAP: Record<string, string> = {
  jdk: '#1890ff',     // JDK 内部 — 蓝色
  spring: '#52c41a',  // Spring — 绿色
  app: '#fa8c16',     // 应用代码 — 橙色
  other: '#bfbfbf',   // 其他 — 灰色
};

/** Tooltip 信息 */
interface TooltipInfo {
  x: number;
  y: number;
  name: string;
  fullSignature: string;
  value: number;
  depth: number;
  colorCategory: string;
}

/**
 * D3 火焰图组件 — 纯 SVG icicle chart 实现
 * 使用 d3.partition 布局，每个矩形代表一个栈帧，宽度正比于覆盖线程数
 */
const D3FlameChart: React.FC<{ data: FlameNode; searchTerm?: string }> = ({ data, searchTerm }) => {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);

  /** d3.partition 布局后的节点类型（带 x0/x1/y0/y1） */
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface RectNode extends d3.HierarchyNode<FlameNode> {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
  }

  const renderChart = useCallback(() => {
    if (!svgRef.current || !containerRef.current || !data) return;

    const container = containerRef.current;
    const width = container.clientWidth || 800;

    // 搜索高亮：计算节点的基础透明度
    const getBaseOpacity = (d: { data: FlameNode }): number => {
      if (!searchTerm) return 1;
      const name = d.data.name || '';
      const fullSig = d.data.fullSignature || '';
      const keyword = searchTerm.toLowerCase();
      return (name.toLowerCase().includes(keyword) || fullSig.toLowerCase().includes(keyword)) ? 1 : 0.15;
    };

    // 先计算最大深度，动态调整行高
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawHierarchy = d3.hierarchy(data, (d: FlameNode) => d.children) as any;
    let maxDepth = 0;
    rawHierarchy.each((node: { depth: number }) => {
      if (node.depth > maxDepth) maxDepth = node.depth;
    });

    // 每行最小 18px，最大 36px，总高度不超过 600px
    const rowHeight = Math.max(18, Math.min(36, Math.floor(600 / (maxDepth + 1))));
    const height = rowHeight * (maxDepth + 1);

    // 构建层次结构并计算 value（叶子节点用自身 value，父节点自动求和）
    // d3-hierarchy 的 sum/sort 在 TS 4.9 下存在泛型签名不兼容，需 any 断言
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const root = d3.hierarchy(data, (d: FlameNode) => d.children) as any;
    root.sum((d: FlameNode) => (d.children && d.children.length > 0) ? 0 : d.value);
    root.sort((a: { value: number }, b: { value: number }) => (b.value || 0) - (a.value || 0));

    // Partition 布局（icicle chart：x=宽度，y=深度）
    const partitionLayout = d3.partition().size([width, height]).padding(1).round(true);
    partitionLayout(root);

    // 强制转换：partition 后节点具有 x0/x1/y0/y1 矩形布局属性
    const layoutRoot = root as RectNode;

    // 清除旧内容，设置 SVG 尺寸
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    // 跳过根节点（depth=0），只渲染子节点
    const nodes = layoutRoot.descendants().slice(1) as RectNode[];

    // 绘制每个节点
    const cell = svg.append<SVGGElement>('g')
      .selectAll<SVGGElement, RectNode>('g')
      .data(nodes)
      .join('g')
      .attr('transform', (d) => `translate(0,${d.y0})`);

    // 矩形色块
    cell.append<SVGRectElement>('rect')
      .attr('x', (d) => d.x0)
      .attr('width', (d) => Math.max(0, d.x1 - d.x0 - 1))
      .attr('height', (d) => Math.max(0, d.y1 - d.y0 - 1))
      .attr('fill', (d) => COLOR_MAP[d.data.colorCategory] || COLOR_MAP.other)
      .attr('rx', 2)
      .attr('ry', 2)
      .attr('cursor', 'pointer')
      .attr('opacity', (d) => getBaseOpacity(d))
      .style('transition', 'opacity 0.15s')
      .on('mouseenter', function (event: MouseEvent, d: RectNode) {
        d3.select(this as Element)
          .attr('stroke', '#333')
          .attr('stroke-width', 1.5)
          .attr('opacity', 0.85);
        const rect = container.getBoundingClientRect();
        setTooltip({
          x: event.clientX,
          y: event.clientY,
          name: d.data.fullSignature || d.data.name,
          fullSignature: d.data.fullSignature,
          value: d.value ?? 0,
          depth: d.depth,
          colorCategory: d.data.colorCategory,
        });
      })
      .on('mousemove', function (event: MouseEvent) {
        setTooltip((prev) => prev ? {
          ...prev,
          x: event.clientX,
          y: event.clientY,
        } : prev);
      })
      .on('mouseleave', function (event: MouseEvent, d: RectNode) {
        d3.select(this as Element)
          .attr('stroke', 'none')
          .attr('opacity', getBaseOpacity(d));
        setTooltip(null);
      })
      .on('click', function (_event: MouseEvent, d: RectNode) {
        const sig = d.data.fullSignature || d.data.name;
        navigator.clipboard?.writeText(sig).then(() => {
          message.success(t('flameGraph.copied'));
        }).catch(() => {
          message.error(t('flameGraph.copyFail'));
        });
      });

    // 文字标签（仅在空间足够时显示）
    cell.append<SVGTextElement>('text')
      .attr('x', (d) => d.x0 + 4)
      .attr('y', (d) => (d.y0 + d.y1) / 2)
      .attr('dy', '0.35em')
      .text((d) => {
        const w = d.x1 - d.x0;
        if (w < 30) return '';
        const name = d.data.name || '';
        const maxLen = Math.floor(w / 6);
        return name.length > maxLen ? name.substring(0, maxLen - 2) + '..' : name;
      })
      .attr('fill', '#fff')
      .attr('font-size', Math.min(12, rowHeight - 6))
      .attr('font-weight', 500)
      .attr('pointer-events', 'none');

  }, [data, searchTerm]);

  useEffect(() => {
    renderChart();

    // 窗口/容器 resize 时重绘
    const resizeObserver = new ResizeObserver(() => {
      renderChart();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [renderChart]);

  return (
    <div ref={containerRef} style={{ position: 'relative', overflowX: 'auto' }}>
      <svg ref={svgRef} style={{ display: 'block' }} />
      {/* Tooltip - position: fixed 避免被容器裁剪 */}
      {tooltip && (() => {
        // 智能定位：tooltip 尺寸约 420x80，根据鼠标位置决定显示方向
        const offset = 14;
        const tipW = 420;
        const tipH = 90;
        const viewW = window.innerWidth;
        const viewH = window.innerHeight;
        // 默认右下方
        let left = tooltip.x + offset;
        let top = tooltip.y + offset;
        // 右侧放不下 → 左侧
        if (tooltip.x + offset + tipW > viewW) {
          left = tooltip.x - tipW - offset;
        }
        // 下方放不下 → 上方
        if (tooltip.y + offset + tipH > viewH) {
          top = tooltip.y - tipH - offset;
        }
        return (
          <div
            style={{
              position: 'fixed',
              left,
              top,
              background: 'rgba(0, 0, 0, 0.85)',
              color: '#fff',
              padding: '10px 14px',
              borderRadius: 8,
              fontSize: 12,
              maxWidth: tipW,
              wordBreak: 'break-all',
              lineHeight: 1.6,
              zIndex: 9999,
              pointerEvents: 'none',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>
              {tooltip.fullSignature || tooltip.name}
            </div>
            <div style={{ opacity: 0.8, marginBottom: 6 }}>
              {t('flameGraph.tooltipThreads', { value: tooltip.value, depth: tooltip.depth })}
            </div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                opacity: 0.6,
              }}
            >
              <CopyOutlined /> {t('flameGraph.tooltipClick')}
            </div>
          </div>
        );
      })()}
    </div>
  );
};

const FlameGraph: React.FC<FlameGraphProps> = ({ flameGraph }) => {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');

  // 计算搜索匹配数量
  const matchCount = useMemo(() => {
    if (!searchTerm || !flameGraph.root) return 0;
    const keyword = searchTerm.toLowerCase();
    let count = 0;
    const walk = (node: FlameNode) => {
      const name = node.name || '';
      const fullSig = node.fullSignature || '';
      if (name.toLowerCase().includes(keyword) || fullSig.toLowerCase().includes(keyword)) {
        count++;
      }
      if (node.children) {
        node.children.forEach(walk);
      }
    };
    walk(flameGraph.root);
    return count;
  }, [searchTerm, flameGraph.root]);


  if (!flameGraph.root) {
    return (
      <Card
        title={
          <Title level={5} style={{ margin: 0 }}>
            {t('flameGraph.title')}
          </Title>
        }
        extra={
          <Popover content={
            <div style={{ maxWidth: 400 }}>
              <p style={{ margin: '0 0 8px' }}>
                <strong>{t('flameGraph.helpContent')}</strong>
              </p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li><strong>{t('flameGraph.helpWidth')}</strong></li>
                <li><strong>{t('flameGraph.helpDepth')}</strong></li>
                <li><strong>{t('flameGraph.helpColor')}</strong></li>
                <li><strong>{t('flameGraph.helpInteraction')}</strong></li>
                <li><strong>{t('flameGraph.helpSearch')}</strong></li>
              </ul>
              <p style={{ margin: '8px 0 0', color: '#999' }}>
                {t('flameGraph.helpFocus')}
              </p>
            </div>
          } title={t('flameGraph.helpTitle')} placement="topRight">
            <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
          </Popover>
        }
      >
        <Empty description={t('flameGraph.noData')} />
      </Card>
    );
  }

  return (
    <Card
      title={
        <Title level={5} style={{ margin: 0 }}>
          {t('flameGraph.title')}
        </Title>
      }
      extra={
        <Popover content={
          <div style={{ maxWidth: 400 }}>
            <p style={{ margin: '0 0 8px' }}>
              <strong>{t('flameGraph.helpContent')}</strong>
            </p>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li><strong>{t('flameGraph.helpWidth')}</strong></li>
              <li><strong>{t('flameGraph.helpDepth')}</strong></li>
              <li><strong>{t('flameGraph.helpColor')}</strong></li>
              <li><strong>{t('flameGraph.helpInteraction')}</strong></li>
              <li><strong>{t('flameGraph.helpSearch')}</strong></li>
            </ul>
            <p style={{ margin: '8px 0 0', color: '#999' }}>
              {t('flameGraph.helpFocus')}
            </p>
          </div>
        } title={t('flameGraph.helpTitle')} placement="topRight">
          <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
        </Popover>
      }
    >
      {/* 图例 + 搜索框 同行 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px 16px',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 2,
                  background: COLOR_MAP.jdk,
                  display: 'inline-block',
                }}
              />{' '}
              {t('flameGraph.colorJdk')}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 2,
                  background: COLOR_MAP.spring,
                  display: 'inline-block',
                }}
              />{' '}
              {t('flameGraph.colorSpring')}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 2,
                  background: COLOR_MAP.app,
                  display: 'inline-block',
                }}
              />{' '}
              {t('flameGraph.colorApp')}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 2,
                  background: COLOR_MAP.other,
                  display: 'inline-block',
                }}
              />{' '}
              {t('flameGraph.colorOther')}
            </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Input
              prefix={<SearchOutlined style={{ color: '#bbb' }} />}
              placeholder={t('flameGraph.searchPlaceholder')}
              allowClear
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: 260, minWidth: 180 }}
              size="small"
            />
            {searchTerm && (
              <span style={{ color: '#999', fontSize: 12, whiteSpace: 'nowrap' }}>
                {t('flameGraph.matchCount', { count: matchCount })}
              </span>
            )}
        </div>
      </div>

      {/* 图表区域 */}
      <D3FlameChart data={flameGraph.root} searchTerm={searchTerm} />
    </Card>
  );
};

export default FlameGraph;
