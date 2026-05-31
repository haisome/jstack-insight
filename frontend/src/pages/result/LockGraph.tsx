import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Card, Typography, Alert, Empty, Tooltip, Badge, Space, Tag, Popover, Button } from 'antd';
import { QuestionCircleOutlined, PlusOutlined, MinusOutlined, ExpandOutlined } from '@ant-design/icons';
import type { LockGraphVO, GraphNode, GraphEdge } from '../../types';

const { Title, Text } = Typography;

interface LockGraphProps {
  lockGraph: LockGraphVO;
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
/** 锁竞争图使用说明 */
const LOCK_HELP_CONTENT = (
  <div style={{ maxWidth: 400 }}>
    <p style={{ margin: '0 0 8px' }}>
      <strong>锁竞争图</strong>用力导向图展示线程与锁之间的持有/等待关系。
    </p>
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      <li><strong>圆形节点</strong> = 线程（蓝色正常，黄色 BLOCKED，红色=死锁线程）</li>
      <li><strong>方形节点</strong> = 锁对象（Monitor / ReentrantLock）</li>
      <li><strong>实线</strong> = 线程持有该锁</li>
      <li><strong>虚线</strong> = 线程等待获取该锁</li>
      <li><strong>红色高亮</strong> = 死锁环路中的节点/边</li>
    </ul>
    <p style={{ margin: '8px 0 0', color: '#999' }}>
      操作：拖拽节点可调整布局，滚轮缩放，悬浮查看详情。
    </p>
  </div>
);

const LockGraph: React.FC<LockGraphProps> = ({ lockGraph }) => {
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

  const { nodes, edges, hasDeadlock, deadlockChains } = lockGraph;

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
    if (!svgRef.current || nodes.length === 0) return;

    // 动态导入 D3（避免 SSR 问题）
    import('d3').then((d3) => {
      const svg = d3.select(svgRef.current!);
      const container = containerRef.current;
      if (!container) return;

      const width = container.clientWidth;
      const height = Math.max(500, Math.min(nodes.length * 20, 700));

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
      const simNodes: SimNode[] = nodes.map((n) => ({
        ...n,
        x: width / 2 + (Math.random() - 0.5) * 200,
        y: height / 2 + (Math.random() - 0.5) * 200,
      }));
      const simEdges: SimEdge[] = edges.map((e, i) => ({
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
      };
    });
  }, [nodes, edges]);

  if (nodes.length === 0) {
    return (
      <Card title={<Title level={5} style={{ margin: 0 }}>锁竞争图</Title>}>
        <Empty description="未检测到锁竞争关系" />
      </Card>
    );
  }

  return (
    <Card
      title={
        <Space>
          <Title level={5} style={{ margin: 0 }}>锁竞争图</Title>
          <Badge
            count={`${nodes.length} 节点`}
            style={{ backgroundColor: '#1677ff' }}
          />
        </Space>
      }
      extra={
        <Space>
          <Popover content={LOCK_HELP_CONTENT} title="使用说明" placement="topRight">
            <QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} />
          </Popover>
          <span style={{ fontSize: 12, color: '#666' }}>● 线程节点 &nbsp; ■ 锁对象 &nbsp; ━ 持有 &nbsp; ┄ 等待</span>
        </Space>
      }
    >
      {/* 死锁警告 */}
      {hasDeadlock && (
        <Alert
          type="error"
          showIcon
          closable
          style={{ marginBottom: 16, borderRadius: 8 }}
          message="检测到死锁环路！"
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
                  {tooltipInfo.node.type === 'THREAD' ? '线程' : '锁'}
                </Text>
                <br />
                <Text style={{ color: '#ddd' }}>
                  {tooltipInfo.node.label}
                </Text>
                {tooltipInfo.node.state && (
                  <>
                    <br />
                    <Text style={{ color: '#ddd' }}>
                      状态: {tooltipInfo.node.state}
                    </Text>
                  </>
                )}
                {tooltipInfo.node.inDeadlock && (
                  <div style={{ color: '#ff4d4f', fontWeight: 600, marginTop: 4 }}>
                    ⚠ 参与死锁
                  </div>
                )}
              </>
            )}
            {tooltipInfo.edge && (
              <>
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>
                  {tooltipInfo.edge.relation === 'HOLDS' ? '持有' : '等待'}
                </Text>
                <br />
                <Text style={{ color: '#ddd', fontSize: 12 }}>
                  {String(tooltipInfo.edge.source)} → {String(tooltipInfo.edge.target)}
                </Text>
                {tooltipInfo.edge.inDeadlock && (
                  <div style={{ color: '#ff4d4f', fontWeight: 600, marginTop: 4 }}>
                    ⚠ 死锁链路
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
            <span>RUNNABLE</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#faad14', display: 'inline-block' }} />
            <span>BLOCKED</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#d9d9d9', display: 'inline-block' }} />
            <span>WAITING</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: '#52c41a', display: 'inline-block' }} />
            <span>锁</span>
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
          <Tooltip title="放大" placement="right">
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
          <Tooltip title="缩小" placement="right">
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
          <Tooltip title="适应视图" placement="right">
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
