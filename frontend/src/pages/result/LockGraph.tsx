import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Card, Typography, Alert, Empty, Tooltip, Badge, Space, Tag, Popover, Button, Input, InputNumber, message } from 'antd';
import { QuestionCircleOutlined, PlusOutlined, MinusOutlined, ExpandOutlined, FilterOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { LockGraphVO, GraphNode, GraphEdge, ThreadSummary } from '../../types';

const { Title, Text } = Typography;

interface LockGraphProps {
  lockGraph: LockGraphVO;
  threads: ThreadSummary[];
  /** 当前 tab 是否可见，隐藏时暂停 D3 仿真以节省性能 */
  visible?: boolean;
}

/**
 * 锁竞争图组件 — 基于 D3.js v7 的力导向图
 *
 * 节点类型：
 *   THREAD（圆形）— 线程节点
 *   LOCK（方形）   — 锁对象节点
 *
 * 连线类型：
 *   HOLDS（实线）  — 线程持有该锁
 *   WAITING（虚线）— 线程等待获取该锁
 *
 * 死锁高亮：死锁环路中的节点和边显示为红色
 */
/** 锁竞争图使用说明 — 模块级常量，内容通过 i18n 在组件中渲染 */

const LockGraph: React.FC<LockGraphProps> = ({ lockGraph, threads, visible = true }) => {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimEdge> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const fitToViewRef = useRef<(() => void) | null>(null);
  const [tooltipInfo, setTooltipInfo] = useState<{
    x: number;
    y: number;
    node?: SimNode;
    edge?: SimEdge;
  } | null>(null);
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<SimEdge | null>(null);
  const [currentZoom, setCurrentZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const threadsRef = useRef<ThreadSummary[]>(threads);
  threadsRef.current = threads;

  const { nodes, edges, hasDeadlock, deadlockChains } = lockGraph;

  // ========== 过滤：包名/锁名 + 自定义延迟 ==========
  const [filterText, setFilterText] = useState('');
  const [debounceDelay, setDebounceDelay] = useState(500);
  const [activeFilter, setActiveFilter] = useState('');
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 过滤输入变更 — 根据用户设定的延迟进行 debounce */
  const handleFilterChange = useCallback(
    (value: string) => {
      setFilterText(value);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      const trimmed = value.trim();
      if (!trimmed) {
        setActiveFilter('');
        return;
      }
      debounceTimerRef.current = setTimeout(() => {
        setActiveFilter(trimmed);
      }, debounceDelay);
    },
    [debounceDelay]
  );

  /** 立即应用过滤（失去焦点或回车时） */
  const handleFilterConfirm = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    const trimmed = filterText.trim();
    setActiveFilter(trimmed);
  }, [filterText]);

  /** 根据 activeFilter 计算过滤后的节点和边 */
  const { displayNodes, displayEdges } = useMemo(() => {
    if (!activeFilter) return { displayNodes: nodes, displayEdges: edges };

    const lowerFilter = activeFilter.toLowerCase();
    const threadsMap = new Map<string, ThreadSummary>();
    threads.forEach((t) => threadsMap.set(t.name, t));

    // 1) 匹配的线程节点 — 检查栈帧中是否包含过滤词
    const matchedThreadIds = new Set<string>();
    nodes.forEach((n) => {
      if (n.type !== 'THREAD') return;
      const thread = threadsMap.get(n.label);
      if (!thread) return;
      const stackMatch = thread.stackTrace.some((frame) =>
        frame.toLowerCase().includes(lowerFilter)
      );
      const nameMatch = thread.name.toLowerCase().includes(lowerFilter);
      if (stackMatch || nameMatch) matchedThreadIds.add(n.id);
    });

    // 2) 匹配的锁节点 — 锁类名包含过滤词
    const matchedLockIds = new Set<string>();
    nodes.forEach((n) => {
      if (n.type === 'LOCK' && n.label.toLowerCase().includes(lowerFilter)) {
        matchedLockIds.add(n.id);
      }
    });

    // 3) 把匹配线程关联的锁也纳入可见集（保持图的完整性）
    edges.forEach((e) => {
      const srcId = e.source;
      const tgtId = e.target;
      const srcIsLock = nodes.find((n) => n.id === srcId)?.type === 'LOCK';
      const tgtIsLock = nodes.find((n) => n.id === tgtId)?.type === 'LOCK';
      if (matchedThreadIds.has(srcId) && tgtIsLock) matchedLockIds.add(tgtId);
      if (matchedThreadIds.has(tgtId) && srcIsLock) matchedLockIds.add(srcId);
    });

    const visibleSet = new Set([...matchedThreadIds, ...matchedLockIds]);

    const filteredNodes = nodes.filter((n) => visibleSet.has(n.id));
    const filteredEdges = edges.filter(
      (e) => visibleSet.has(e.source) && visibleSet.has(e.target)
    );

    return { displayNodes: filteredNodes, displayEdges: filteredEdges };
  }, [nodes, edges, threads, activeFilter]);

  // ========== 栈跟踪还原辅助（复用 CpuAnalysis / Threads 中的实现） ==========
  function buildRawStackLines(thread: ThreadSummary): string[] {
    const lines: string[] = [];
    const hasWaitingLock = !!thread.waitingOnLock;
    let waitingInserted = false;

    for (let i = 0; i < (thread.stackTrace?.length ?? 0); i++) {
      lines.push(`at ${thread.stackTrace[i]}`);
      if (!waitingInserted && hasWaitingLock && i === 0) {
        waitingInserted = true;
        let lockLine = '';
        if (thread.state === 'BLOCKED') {
          lockLine = '- waiting to lock';
        } else {
          lockLine = '- parking to wait for';
        }
        lockLine += `  <${thread.waitingOnLock}>`;
        if (thread.waitingOnLockClass) {
          lockLine += ` (a ${thread.waitingOnLockClass})`;
        }
        lines.push(lockLine);
      }
    }

    thread.lockedMonitors?.forEach((addr, idx) => {
      let line = `- locked <${addr}>`;
      if (thread.lockedMonitorClasses?.[idx]) {
        line += ` (a ${thread.lockedMonitorClasses[idx]})`;
      }
      lines.push(line);
    });

    return lines;
  }

  // ResizeObserver：跟踪容器宽度，宽度为 0 时不初始化 D3（容器不可见）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setContainerWidth(w);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      setTooltipInfo({
        x: e.clientX,
        y: e.clientY,
        node: hoveredNode || undefined,
        edge: hoveredEdge || undefined,
      });
    },
    [hoveredNode, hoveredEdge]
  );

  /** 放大 */
  const handleZoomIn = useCallback(() => {
    if (!zoomRef.current || !svgRef.current) return;
    import('d3').then((d3) => {
      const svg = d3.select(svgRef.current!);
      (svg as any).transition().duration(300).call(zoomRef.current!.scaleBy, 1.3);
    });
  }, []);

  /** 缩小 */
  const handleZoomOut = useCallback(() => {
    if (!zoomRef.current || !svgRef.current) return;
    import('d3').then((d3) => {
      const svg = d3.select(svgRef.current!);
      (svg as any).transition().duration(300).call(zoomRef.current!.scaleBy, 0.7);
    });
  }, []);

  /** 适应视图 */
  const handleFitToView = useCallback(() => {
    if (fitToViewRef.current) {
      fitToViewRef.current();
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    if (!svgRef.current || displayNodes.length === 0 || containerWidth === 0) return;

    // 动态导入 D3（避免 SSR 问题）
    import('d3').then((d3) => {
      const svg = d3.select(svgRef.current!);
      const container = containerRef.current;
      if (!container) return;

      const width = container.clientWidth;
      const height = Math.max(500, Math.min(displayNodes.length * 20, 700));

      svg.attr('width', width).attr('height', height);
      svg.selectAll('*').remove();

      // 定义箭头标记
      const defs = svg.append('defs');
      ['normal', 'deadlock'].forEach((type) => {
        const color = type === 'deadlock' ? '#ff4d4f' : '#8c8c8c';
        defs
          .append('marker')
          .attr('id', `arrow-${type}`)
          .attr('viewBox', '0 -5 10 10')
          .attr('refX', 20)
          .attr('refY', 0)
          .attr('markerWidth', 8)
          .attr('markerHeight', 8)
          .attr('orient', 'auto')
          .append('path')
          .attr('d', 'M0,-5L10,0L0,5')
          .attr('fill', color);
      });

      // 构建仿真数据
      const simNodes: SimNode[] = displayNodes.map((n) => ({
        ...n,
        x: width / 2 + (Math.random() - 0.5) * 200,
        y: height / 2 + (Math.random() - 0.5) * 200,
      }));
      const simEdges: SimEdge[] = displayEdges.map((e, i) => ({
        id: `edge-${i}`,
        source: e.source,
        target: e.target,
        relation: e.relation,
        inDeadlock: e.inDeadlock,
      }));

      // 创建 SVG 分组
      const g = svg.append('g');
      gRef.current = g;

      // 缩放控制
      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 5])
        .on('zoom', (event) => {
          g.attr('transform', event.transform);
          setCurrentZoom(event.transform.k);
        });
      (svg as unknown as d3.Selection<SVGSVGElement, unknown, null, undefined>).call(zoom);
      zoomRef.current = zoom;

      // 力仿真
      const simulation = d3
        .forceSimulation<SimNode>(simNodes)
        .force(
          'link',
          d3
            .forceLink<SimNode, SimEdge>(simEdges)
            .id((d) => d.id)
            .distance(80)
        )
        .force('charge', d3.forceManyBody().strength(-400))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide(30));

      simulationRef.current = simulation;

      // 自动适应视图函数
      const fitToView = () => {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        simNodes.forEach((node) => {
          if (node.x == null || node.y == null) return;
          if (node.x < minX) minX = node.x;
          if (node.x > maxX) maxX = node.x;
          if (node.y < minY) minY = node.y;
          if (node.y > maxY) maxY = node.y;
        });
        if (minX === Infinity) return;
        const padding = 40;
        const dx = maxX - minX + padding * 2;
        const dy = maxY - minY + padding * 2;
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const scale = Math.min(
          width / dx,
          height / dy,
          2 // 最大缩放倍数
        );
        const newTransform = d3.zoomIdentity
          .translate(width / 2, height / 2)
          .scale(scale)
          .translate(-cx, -cy);
        svg.transition().duration(600).call(zoom.transform, newTransform);
        setCurrentZoom(scale);
      };
      fitToViewRef.current = fitToView;

      // 绘制连线
      const link = g
        .append('g')
        .selectAll<SVGLineElement, SimEdge>('line')
        .data(simEdges)
        .join('line')
        .attr('stroke', (d) =>
          d.inDeadlock ? '#ff4d4f' : d.relation === 'HOLDS' ? '#1677ff' : '#faad14'
        )
        .attr('stroke-width', (d) => (d.inDeadlock ? 3 : 2))
        .attr('stroke-dasharray', (d) => (d.relation === 'WAITING' ? '6,4' : 'none'))
        .attr('marker-end', (d) =>
          `url(#arrow-${d.inDeadlock ? 'deadlock' : 'normal'})`
        )
        .attr('opacity', (d) => (d.inDeadlock ? 1 : 0.7));

      // 连线 Hover 事件
      link
        .on('mouseenter', function (_event: MouseEvent, d: SimEdge) {
          setHoveredEdge(d);
          setHoveredNode(null);
          d3.select(this).attr('stroke-width', 4).attr('opacity', 1);
        })
        .on('mouseleave', function () {
          setHoveredEdge(null);
          setTooltipInfo(null);
          const sel = d3.select<SVGLineElement, SimEdge>(this);
          sel.attr('stroke-width', (d) => (d.inDeadlock ? 3 : 2)).attr('opacity', (d) => (d.inDeadlock ? 1 : 0.7));
        });

      // 绘制节点组
      const nodeGroup = g
        .append('g')
        .selectAll<SVGGElement, SimNode>('g')
        .data(simNodes)
        .join('g')
        .call(
          d3
            .drag<SVGGElement, SimNode>()
            .on('start', (event, d) => {
              if (!event.active) simulation.alphaTarget(0.3).restart();
              d.fx = d.x;
              d.fy = d.y;
            })
            .on('drag', (event, d) => {
              d.fx = event.x;
              d.fy = event.y;
            })
            .on('end', (event, d) => {
              if (!event.active) simulation.alphaTarget(0);
              d.fx = null;
              d.fy = null;
            })
        );

      // 节点形状：线程=圆形，锁=方形
      nodeGroup
        .filter((d) => d.type === 'THREAD')
        .append('circle')
        .attr('r', 16)
        .attr('fill', (d) =>
          d.inDeadlock
            ? '#ff4d4f'
            : d.state === 'BLOCKED'
            ? '#faad14'
            : d.state === 'WAITING'
            ? '#d9d9d9'
            : '#1677ff'
        )
        .attr('stroke', (d) => (d.inDeadlock ? '#a8071a' : '#fff'))
        .attr('stroke-width', 2)
        .attr('cursor', 'pointer');

      nodeGroup
        .filter((d) => d.type === 'LOCK')
        .append('rect')
        .attr('x', -14)
        .attr('y', -14)
        .attr('width', 28)
        .attr('height', 28)
        .attr('rx', 4)
        .attr('fill', (d) => (d.inDeadlock ? '#ff4d4f' : '#52c41a'))
        .attr('stroke', (d) => (d.inDeadlock ? '#a8071a' : '#fff'))
        .attr('stroke-width', 2)
        .attr('cursor', 'pointer');

      // 节点标签
      nodeGroup
        .append('text')
        .text((d) => {
          const label = d.label;
          return label.length > 18 ? label.substring(0, 16) + '...' : label;
        })
        .attr('dy', (d) => (d.type === 'THREAD' ? 32 : 32))
        .attr('text-anchor', 'middle')
        .attr('font-size', 11)
        .attr('font-weight', (d) => (d.type === 'THREAD' ? 600 : 400))
        .attr('fill', '#333')
        .style('pointer-events', 'none')
        .style('user-select', 'none');

      // 节点 Hover 事件
      nodeGroup
        .on('mouseenter', function (_event, d) {
          setHoveredNode(d);
          setHoveredEdge(null);
          d3.select(this)
            .select(d.type === 'THREAD' ? 'circle' : 'rect')
            .attr('stroke', '#1677ff')
            .attr('stroke-width', 3);
        })
        .on('mouseleave', function (d) {
          setHoveredNode(null);
          setTooltipInfo(null);
          d3.select(this)
            .select(d.type === 'THREAD' ? 'circle' : 'rect')
            .attr('stroke', d.inDeadlock ? '#a8071a' : '#fff')
            .attr('stroke-width', 2);
        })
        .on('click', function (event: MouseEvent, d: SimNode) {
          event.stopPropagation();
          if (d.type === 'THREAD') {
            // 点击线程节点：复制栈信息到剪贴板
            const currentThreads = threadsRef.current;
            const thread = currentThreads.find(t => t.name === d.label);
            if (thread) {
              const stackText = buildRawStackLines(thread).join('\n');
              navigator.clipboard.writeText(stackText).then(() => {
                message.success(t('lockGraph.copiedThreadStack', { name: d.label }));
              }).catch(() => {
                // 剪贴板 API 不可用时降级为 document.execCommand
                const textarea = document.createElement('textarea');
                textarea.value = stackText;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                message.success(t('lockGraph.copiedThreadStack', { name: d.label }));
              });
            } else {
              message.warning(t('lockGraph.warnNoStack'));
            }
          } else if (d.type === 'LOCK') {
            // 点击锁节点：复制锁对象信息
            navigator.clipboard.writeText(d.label).then(() => {
              message.success(t('lockGraph.copiedLock', { name: d.label }));
            }).catch(() => {
              const textarea = document.createElement('textarea');
              textarea.value = d.label;
              document.body.appendChild(textarea);
              textarea.select();
              document.execCommand('copy');
              document.body.removeChild(textarea);
              message.success(t('lockGraph.copiedLock', { name: d.label }));
            });
          }
        });

      // Tick：每帧更新位置
      let fitted = false;
      simulation.on('tick', () => {
        link
          .attr('x1', (d) => (d.source as unknown as SimNode).x!)
          .attr('y1', (d) => (d.source as unknown as SimNode).y!)
          .attr('x2', (d) => (d.target as unknown as SimNode).x!)
          .attr('y2', (d) => (d.target as unknown as SimNode).y!);

        nodeGroup.attr('transform', (d) => `translate(${d.x},${d.y})`);

        // 仿真接近稳定时自动适应视图（仅一次）
        if (!fitted && simulation.alpha() < 0.05) {
          fitted = true;
          setTimeout(() => fitToView(), 100);
        }
      });

      // 清理
      return () => {
        simulation.stop();
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      };
    });
  }, [displayNodes, displayEdges, containerWidth, visible]);
  if (nodes.length === 0) {
    return (
      <Card title={<Title level={5} style={{ margin: 0 }}>{t('lockGraph.title')}</Title>}>
        <Empty description={t('lockGraph.noData')} />
      </Card>
    );
  }

  return (
    <Card
      title={
        <Space>
          <Title level={5} style={{ margin: 0 }}>{t('lockGraph.title')}</Title>
          <Badge
            count={activeFilter
              ? t('lockGraph.filteredNodeCount', { display: displayNodes.length, total: nodes.length })
              : t('lockGraph.nodeCount', { count: nodes.length })
            }
            style={{ backgroundColor: activeFilter ? '#722ed1' : '#1677ff' }}
          />
          {activeFilter && (
            <Tag color="purple" style={{ fontSize: 11 }}>
              <FilterOutlined /> &quot;{activeFilter}&quot;
            </Tag>
          )}
        </Space>
      }
      extra={
        <Space>
          <Popover
            content={
              <div style={{ maxWidth: 400 }}>
                <p style={{ margin: '0 0 8px' }}>{t('lockGraph.helpContent')}</p>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  <li>{t('lockGraph.helpNodeThread')}</li>
                  <li>{t('lockGraph.helpNodeLock')}</li>
                  <li>{t('lockGraph.helpEdgeHolds')}</li>
                  <li>{t('lockGraph.helpEdgeWaiting')}</li>
                  <li>{t('lockGraph.helpDeadlock')}</li>
                </ul>
                <p style={{ margin: '8px 0 0', color: '#999' }}>{t('lockGraph.helpOperation')}</p>
              </div>
            }
            title={t('lockGraph.helpTitle')} placement="topRight"
          >
            <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
          </Popover>
          <span style={{ fontSize: 12, color: '#666' }}>
            ● {t('lockGraph.legendThreadNode')} &nbsp; ■ {t('lockGraph.legendLockNode')} &nbsp; ━ {t('lockGraph.legendHoldsEdge')} &nbsp; ┄ {t('lockGraph.legendWaitingEdge')}
          </span>
        </Space>
      }
    >
      {/* 过滤栏 */}
      <div
        style={{
          marginBottom: 12,
          padding: '8px 12px',
          background: '#fafafa',
          borderRadius: 8,
          border: '1px solid #f0f0f0',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <FilterOutlined style={{ color: '#722ed1', fontSize: 14 }} />
        <Input
          placeholder={t('lockGraph.filterPlaceholder')}
          value={filterText}
          onChange={(e) => handleFilterChange(e.target.value)}
          onPressEnter={handleFilterConfirm}
          onBlur={handleFilterConfirm}
          allowClear
          style={{ flex: 1, minWidth: 260 }}
        />
        <span style={{ fontSize: 12, color: '#999', whiteSpace: 'nowrap' }}>{t('lockGraph.delayLabel')}</span>
        <InputNumber
          min={0}
          max={5000}
          step={100}
          value={debounceDelay}
          onChange={(v) => setDebounceDelay(v ?? 500)}
          addonAfter="ms"
          size="middle"
          style={{ width: 120 }}
        />
      </div>

      {/* 过滤后无结果 */}
      {activeFilter && displayNodes.length === 0 && (
        <Empty
          description={t('lockGraph.filterResult', { keyword: activeFilter })}
          style={{ marginBottom: 16 }}
        />
      )}

      {/* 死锁警告 */}
      {hasDeadlock && (
        <Alert
          type="error"
          showIcon
          closable
          style={{ marginBottom: 16, borderRadius: 8 }}
          message={t('lockGraph.deadlockAlert')}
          description={
            <div>
              {deadlockChains.map((chain, i) => (
                <div key={i} style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {chain}
                </div>
              ))}
            </div>
          }
        />
      )}

      {/* SVG 容器 */}
      <div
        ref={containerRef}
        style={{ position: 'relative', overflow: 'hidden', borderRadius: 8, border: '1px solid #f0f0f0' }}
        onMouseMove={handleMouseMove}
      >
        <svg ref={svgRef} style={{ display: 'block', cursor: 'grab' }} />

        {/* 浮动 Tooltip — fixed 定位，不受容器 overflow 裁剪 */}
        {tooltipInfo && (tooltipInfo.node || tooltipInfo.edge) && (
          <div
            style={{
              position: 'fixed',
              left: tooltipInfo.x + 12,
              top: tooltipInfo.y + 12,
              background: 'rgba(0,0,0,0.85)',
              color: '#fff',
              padding: '8px 12px',
              borderRadius: 6,
              fontSize: 12,
              pointerEvents: 'none',
              zIndex: 9999,
              maxWidth: 300,
              wordBreak: 'break-all',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}
          >
            {tooltipInfo.node && (
              <>
                <Text
                  style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}
                >
                  {tooltipInfo.node.type === 'THREAD' ? t('lockGraph.tooltipThread') : t('lockGraph.tooltipLock')}
                </Text>
                <br />
                <Text style={{ color: '#ddd' }}>
                  {tooltipInfo.node.label}
                </Text>
                {tooltipInfo.node.state && (
                  <>
                    <br />
                    <Text style={{ color: '#ddd' }}>
                      {t('lockGraph.tooltipState')}{tooltipInfo.node.state}
                    </Text>
                  </>
                )}
                {tooltipInfo.node.inDeadlock && (
                  <div style={{ color: '#ff4d4f', fontWeight: 600, marginTop: 4 }}>
                    {t('lockGraph.tooltipDeadlock')}
                  </div>
                )}
                <div style={{ color: '#8cc8ff', fontSize: 11, marginTop: 6, fontStyle: 'italic' }}>
                  {tooltipInfo.node.type === 'THREAD'
                    ? t('lockGraph.clickCopyThreadHint')
                    : t('lockGraph.clickCopyLockHint')}
                </div>
              </>
            )}
            {tooltipInfo.edge && (
              <>
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>
                  {tooltipInfo.edge.relation === 'HOLDS' ? t('threads.relationHolds') : t('threads.relationWaiting')}
                </Text>
                <br />
                <Text style={{ color: '#ddd', fontSize: 12 }}>
                  {String(tooltipInfo.edge.source)} → {String(tooltipInfo.edge.target)}
                </Text>
                {tooltipInfo.edge.inDeadlock && (
                  <div style={{ color: '#ff4d4f', fontWeight: 600, marginTop: 4 }}>
                    {t('threads.deadlockChain')}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* 图例 */}
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            right: 12,
            background: 'rgba(255,255,255,0.92)',
            padding: '8px 14px',
            borderRadius: 6,
            fontSize: 11,
            border: '1px solid #f0f0f0',
            display: 'flex',
            gap: 14,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#1677ff', display: 'inline-block' }} />
            <span>{t('lockGraph.legendRunnable')}</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#faad14', display: 'inline-block' }} />
            <span>{t('lockGraph.legendBlocked')}</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#d9d9d9', display: 'inline-block' }} />
            <span>{t('lockGraph.legendWaiting')}</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: '#52c41a', display: 'inline-block' }} />
            <span>{t('lockGraph.legendLock')}</span>
          </span>
        </div>

        {/* 缩放控制按钮 */}
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            zIndex: 50,
          }}
        >
          <Tooltip title={t('lockGraph.zoomIn')} placement="right">
            <Button
              type="text"
              size="small"
              icon={<PlusOutlined />}
              onClick={handleZoomIn}
              style={{
                width: 32,
                height: 32,
                background: 'rgba(255,255,255,0.9)',
                border: '1px solid #f0f0f0',
                borderRadius: 6,
              }}
            />
          </Tooltip>
          <Tooltip title={t('lockGraph.zoomOut')} placement="right">
            <Button
              type="text"
              size="small"
              icon={<MinusOutlined />}
              onClick={handleZoomOut}
              style={{
                width: 32,
                height: 32,
                background: 'rgba(255,255,255,0.9)',
                border: '1px solid #f0f0f0',
                borderRadius: 6,
              }}
            />
          </Tooltip>
          <Tooltip title={t('lockGraph.fitView')} placement="right">
            <Button
              type="text"
              size="small"
              icon={<ExpandOutlined />}
              onClick={handleFitToView}
              style={{
                width: 32,
                height: 32,
                background: 'rgba(255,255,255,0.9)',
                border: '1px solid #f0f0f0',
                borderRadius: 6,
              }}
            />
          </Tooltip>
        </div>
      </div>
    </Card>
  );
};

// ================================================================
// 内部仿真类型（扩展了位置属性）
// ================================================================

interface SimNode extends GraphNode {
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

/**
 * SimEdge 必须满足 d3.SimulationLinkDatum<SimNode> 约束。
 * source/target 在仿真过程中会被 d3 替换为 SimNode 对象，
 * 初始化时传入 string（节点 id）即可。
 */
interface SimEdge {
  id: string;
  source: string | SimNode;
  target: string | SimNode;
  relation: 'HOLDS' | 'WAITING';
  inDeadlock: boolean;
}

export default LockGraph;
