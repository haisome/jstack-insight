package com.zeng.jstackinsight.api.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * CPU 线程推测结果 VO。
 *
 * <p>前端「CPU 线程推测」页与导出的 HTML 报告共用同一份分析结果，
 * 避免前端（只有线程摘要、无调用栈）与后端（有完整调用栈）各算一套导致数量不一致。
 *
 * @author zeng
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CpuInferenceVO {

    /**
     * 分类取值：与前端 CpuAnalysis 的 ThreadCategory 保持一致。
     *
     * <p>判定依据 fastThread 的 Athlete 模式（https://blog.fastthread.io/really-running/）：
     * 线程处于 RUNNABLE 不代表真的在消耗 CPU —— JVM 无法感知 Native 方法内部状态，
     * 阻塞在 socket 读写等 Native 调用上时仍被标记为 RUNNABLE。
     * 判断"是否真的在跑"只能看<b>栈顶帧</b>（线程当前正在执行的位置）。
     */
    public static final String CAT_CPU = "cpu_consuming";
    public static final String CAT_IO = "io_wait";
    public static final String CAT_GC = "gc";
    /** 栈顶为 Native 方法，但不属于已知阻塞点：可能是瞬时 Native 调用，无法认定为 CPU 消耗 */
    public static final String CAT_NATIVE = "native";
    /** 无调用栈（JVM 内部线程，jstack 不输出 Java 栈），无法判断 */
    public static final String CAT_NO_STACK = "no_stack";

    /** RUNNABLE 线程总数 */
    private int total;

    /** 疑似 CPU 消耗线程数 */
    private int cpuCount;

    /** IO 等待线程数 */
    private int ioCount;

    /** GC / JVM 系统线程数 */
    private int gcCount;

    /** Native 未知线程数（栈顶为 Native 方法但非已知阻塞点） */
    private int nativeCount;

    /** 无调用栈线程数（JVM 内部线程） */
    private int noStackCount;

    /** 明细行（已按 CPU 消耗 → IO 等待 → GC 系统 排序） */
    private List<CpuThreadRow> rows;

    /**
     * 单条推测结果
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class CpuThreadRow {
        /** 分类：cpu_consuming / io_wait / gc */
        private String category;
        /** 线程详情（含完整调用栈） */
        private ThreadStateVO.ThreadSummary thread;
        /** 评估理由 */
        private List<String> reasons;
        /** 调用栈深度 */
        private int stackDepth;
        /** 栈顶帧 */
        private String topFrame;
    }
}
