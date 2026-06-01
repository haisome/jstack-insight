package com.zeng.jstackinsight.api.response;

import lombok.Builder;
import lombok.Data;

import java.util.List;

/**
 * top -H 线程 CPU 分析结果 VO
 *
 * <p>解析 top -H 输出文件，与 jstack 线程进行 PID(十进制) <-> NID(十六进制) 关联，
 * 返回各线程的精确 CPU 占用率。
 *
 * @author zeng
 */
@Data
@Builder
public class TopCpuVO {

    /** 总线程数（top 文件中解析出的） */
    private int totalThreads;

    /** CPU 总占用（所有线程 CPU% 之和） */
    private double totalCpuPercent;

    /** 成功匹配的线程数 */
    private int matchedCount;

    /** 未匹配的线程数（top 中有但 jstack 中无对应 nid） */
    private int unmatchedCount;

    /** 匹配到的线程 CPU 明细列表 */
    private List<ThreadCpuInfo> threads;

    /**
     * 单个线程的 CPU 信息
     */
    @Data
    @Builder
    public static class ThreadCpuInfo {
        /** 线程名（来自 jstack） */
        private String name;
        /** 系统线程 ID（十进制，来自 top PID 列） */
        private int pid;
        /** nid（十六进制，来自 jstack） */
        private String nid;
        /** CPU 占用率（来自 top %CPU 列） */
        private double cpuPercent;
        /** 线程状态（来自 jstack） */
        private String state;
        /** 栈顶帧（来自 jstack） */
        private String topFrame;
        /** 是否参与死锁 */
        private boolean inDeadlock;
    }
}
