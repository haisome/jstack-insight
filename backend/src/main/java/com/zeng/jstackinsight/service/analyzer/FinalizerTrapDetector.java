package com.zeng.jstackinsight.service.analyzer;

import com.zeng.jstackinsight.service.parser.model.ThreadInfo;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Finalizer Trap 检测器
 *
 * <h2>Leprechaun Trap（小妖精陷阱）模式</h2>
 *
 * <p>当 {@code finalize()} 方法实现不当导致 {@code Finalizer} 守护线程被阻塞时，
 * {@code java.lang.ref.Finalizer} 内部队列会不断增长，最终引发 {@code OutOfMemoryError}。
 *
 * <p><b>检测逻辑：</b>
 * <ul>
 *   <li>查找名为 {@code "Finalizer"} 的守护线程</li>
 *   <li>检查其调用栈是否包含某个类的 {@code finalize()} 方法（表示正在执行 finalization）</li>
 *   <li>检查线程状态是否非 {@code RUNNABLE}（{@code BLOCKED}/{@code WAITING}/{@code TIMED_WAITING}
 *       表示 Finalizer 线程无法继续处理队列）</li>
 * </ul>
 *
 * <p><b>参考：</b>
 * <a href="https://blog.fastthread.io/thread-dump-analysis-pattern-leprechaun-trap/">
 *   fastthread.io - Leprechaun Trap
 * </a>
 *
 * @author zeng
 */
@Component
public class FinalizerTrapDetector {

    /**
     * 执行 Finalizer Trap 检测。
     *
     * @param threads 所有线程信息列表
     * @return 检测结果，包含陷入陷阱的线程名集合
     */
    public DetectionResult detect(java.util.List<ThreadInfo> threads) {
        Set<String> trappedThreads = new LinkedHashSet<>();

        for (ThreadInfo t : threads) {
            if (isFinalizerTrapped(t)) {
                trappedThreads.add(t.getName());
            }
        }

        return new DetectionResult(!trappedThreads.isEmpty(), trappedThreads);
    }

    /**
     * 判断单个线程是否陷入 Finalizer Trap。
     *
     * <p>条件：线程名为 {@code "Finalizer"} + 守护线程 + 调用栈包含 {@code finalize()} 方法
     * + 线程状态非 {@code RUNNABLE}（表示被阻塞）。
     */
    private boolean isFinalizerTrapped(ThreadInfo thread) {
        // 1. 必须是名为 "Finalizer" 的守护线程
        if (!"Finalizer".equals(thread.getName()) || !thread.isDaemon()) {
            return false;
        }

        // 2. 必须正在执行某个类的 finalize() 方法（调用栈中包含 ".finalize("）
        boolean inFinalize = false;
        for (String frame : thread.getStackFrames()) {
            if (frame.contains(".finalize(")) {
                inFinalize = true;
                break;
            }
        }
        if (!inFinalize) {
            return false;
        }

        // 3. 线程状态必须是非 RUNNABLE（BLOCKED/WAITING/TIMED_WAITING 表示卡住了）
        //    注意：RUNNABLE 也可能是瞬时状态，但 FINALIZER 在 RUNNABLE 时通常在正常工作
        String state = thread.getState();
        if ("RUNNABLE".equals(state)) {
            // RUNNABLE 的 Finalizer 可能正在正常执行 finalize()，不一定是陷阱
            // 但为了更积极检测，我们也可以标记它（用户可自行判断）
            // 这里选择保守策略：仅当非 RUNNABLE 时才标记
            return false;
        }

        return true;
    }

    // ========== 检测结果 ==========

    public static class DetectionResult {
        private final boolean detected;
        private final Set<String> trappedThreadNames;

        public DetectionResult(boolean detected, Set<String> trappedThreadNames) {
            this.detected = detected;
            this.trappedThreadNames = Collections.unmodifiableSet(trappedThreadNames);
        }

        public boolean isDetected() { return detected; }
        public Set<String> getTrappedThreadNames() { return trappedThreadNames; }
    }
}
