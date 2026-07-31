package com.zeng.jstackinsight.api.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 锁竞争关系图 VO（前端力导向图数据）
 *
 * <p>此 VO 为前端「锁竞争图」（Force Graph）提供图数据（Nodes + Edges）。
 *
 * <h3>JVM 锁机制简介</h3>
 * <p>JVM 中存在两种主要的锁实现：
 * <ol>
 *   <li><b>Object Monitor（监视器锁）</b>：即 {@code synchronized} 关键字背后的机制。
 *       JVM 在对象头（Object Header）的 Mark Word 中存储锁状态。
 *       jstack 输出中表现为 {@code - locked <0x...>} 和 {@code waiting to lock <0x...>}。</li>
 *   <li><b>AQS（AbstractQueuedSynchronizer）</b>：{@code java.util.concurrent} 包中
 *       {@code ReentrantLock}、{@code Semaphore}、{@code CountDownLatch} 等的底层实现。
 *       jstack 中表现为 {@code parking to wait for <0x...>}（LockSupport.park 挂起）。</li>
 * </ol>
 *
 * <p>图结构说明：
 * <ul>
 *   <li>节点（Node）：线程（圆形）或锁对象（方形）</li>
 *   <li>边（Edge）：HOLDS（持有，实线）或 WAITING（等待，虚线）</li>
 *   <li>死锁检测：若存在环路，相关节点/边标记 {@code inDeadlock=true}</li>
 * </ul>
 *
 * @author zeng
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LockGraphVO {

    /** 图中所有节点（线程节点 + 锁节点） */
    private List<GraphNode> nodes;

    /** 图中所有边（持有 / 等待关系） */
    private List<GraphEdge> edges;

    /** 是否存在死锁（前端据此显示红色警报样式） */
    private boolean hasDeadlock;

    /** 死锁链路描述（人类可读，如 "Thread-A → Lock-X → Thread-B → Lock-Y → Thread-A"） */
    private List<String> deadlockChains;

    // ================================================================
    // 内部数据结构
    // ================================================================

    /**
     * 图节点
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class GraphNode {
        /** 唯一 ID，线程节点用 tid，锁节点用 lockAddress */
        private String id;
        /** 显示标签 */
        private String label;
        /**
         * 节点类型：
         * <ul>
         *   <li>{@code THREAD}  — 线程节点（圆形）</li>
         *   <li>{@code LOCK}    — 锁对象节点（方形）</li>
         * </ul>
         */
        private String type;
        /** 线程状态（仅 THREAD 节点有效）：RUNNABLE / BLOCKED / WAITING 等 */
        private String state;
        /** 该节点是否处于死锁链路中 */
        private boolean inDeadlock;
    }

    /**
     * 图边（有向边）
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class GraphEdge {
        /** 起点节点 ID */
        private String source;
        /** 终点节点 ID */
        private String target;
        /**
         * 边类型：
         * <ul>
         *   <li>{@code HOLDS}   — 线程持有该锁（实线）</li>
         *   <li>{@code WAITING} — 线程等待获取该锁（虚线）</li>
         * </ul>
         */
        private String relation;
        /** 是否处于死锁链路中（前端渲染为红色） */
        private boolean inDeadlock;
    }
}
