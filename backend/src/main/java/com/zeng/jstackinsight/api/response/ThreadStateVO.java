package com.zeng.jstackinsight.api.response;

import lombok.Builder;
import lombok.Data;

import java.util.List;
import java.util.Map;

/**
 * 线程状态汇总 VO
 *
 * <p>对应前端「概览」页的饼图和指标卡数据。
 * 汇总各 JVM 线程状态的分布数量，以及全部线程的摘要列表。
 *
 * <p>JVM 线程状态（{@link java.lang.Thread.State}）说明：
 * <ul>
 *   <li>RUNNABLE  — 线程正在运行或可被调度运行（含系统调用中的线程）</li>
 *   <li>BLOCKED   — 等待获取对象监视器锁（Monitor Lock，即 synchronized 关键字保护的锁）</li>
 *   <li>WAITING   — 无限期等待（Object.wait()、LockSupport.park() 等）</li>
 *   <li>TIMED_WAITING — 有超时限制的等待</li>
 *   <li>NEW / TERMINATED — 未启动 / 已终止</li>
 * </ul>
 *
 * @author zeng
 */
@Data
@Builder
public class ThreadStateVO {

    /** 线程总数 */
    private int totalThreads;

    /** 各状态计数，Key 为状态名（大写），Value 为数量 */
    private Map<String, Integer> stateCounts;

    /** 死锁线程数量（已被 DFS 算法检测确认） */
    private int deadlockCount;

    /** 线程摘要列表，用于前端表格 */
    private List<ThreadSummary> threads;

    /**
     * 单个线程的摘要信息（用于列表展示，避免传输完整调用栈）
     */
    @Data
    @Builder
    public static class ThreadSummary {
        /** 线程名称，如 "main"、"pool-1-thread-1" */
        private String name;
        /** 线程 ID（十进制）*/
        private long tid;
        /** 系统级原生线程 ID（十六进制，来自 jstack nid=0x...） */
        private String nid;
        /** 线程状态 */
        private String state;
        /** 该线程是否处于死锁链路中 */
        private boolean inDeadlock;
        /** 该线程当前等待的锁地址（如有） */
        private String waitingOnLock;
        /** 该线程当前等待的锁类型全限定名（如有） */
        private String waitingOnLockClass;
        /** 该线程持有的锁地址列表 */
        private List<String> lockedMonitors;
        /** 该线程持有的锁类型全限定名列表（与 lockedMonitors 一一对应） */
        private List<String> lockedMonitorClasses;
        /** 调用栈（完整，用于详情展示）*/
        private List<String> stackTrace;
        /** CPU 占用估算（来自 nid 与 top 命令映射，可选） */
        private Double cpuPercent;
    }
}
