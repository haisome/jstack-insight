package com.zeng.jstackinsight.service.analyzer;

import com.zeng.jstackinsight.service.parser.model.ThreadInfo;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 异常线程检测器
 *
 * <h2>线程抛出异常模式</h2>
 *
 * <p>当线程的调用栈顶部包含 {@code Exception} 或 {@code Error} 的 {@code <init>} 构造方法时，
 * 表示该线程正在抛出异常，这是问题的重要线索。
 *
 * <p><b>检测逻辑：</b>
 * <ul>
 *   <li>遍历线程的调用栈帧</li>
 *   <li>若任意栈帧匹配 {@code *Exception.<init>(*)} 或 {@code *Error.<init>(*)} 模式，
 *       则该线程正在抛出异常</li>
 * </ul>
 *
 * <p><b>参考：</b>
 * <a href="https://blog.fastthread.io/threads-throwing-exception/">
 *   fastthread.io - Threads Throwing Exception
 * </a>
 *
 * @author zeng
 */
@Component
public class ExceptionDetector {

    private static final Pattern EXCEPTION_INIT_PATTERN =
            Pattern.compile("(?:Exception|Error)\\.<init>\\(");

    /**
     * 执行异常线程检测。
     *
     * @param threads 所有线程信息列表
     * @return 检测结果，包含正在抛出异常的线程名集合
     */
    public DetectionResult detect(java.util.List<ThreadInfo> threads) {
        Set<String> exceptionThreads = new LinkedHashSet<>();

        for (ThreadInfo t : threads) {
            if (isThrowingException(t)) {
                exceptionThreads.add(t.getName());
            }
        }

        return new DetectionResult(!exceptionThreads.isEmpty(), exceptionThreads);
    }

    /**
     * 判断单个线程是否正在抛出异常。
     *
     * <p>条件：调用栈中任意帧匹配 {@code *Exception.<init>(*)} 或 {@code *Error.<init>(*)} 模式。
     */
    private boolean isThrowingException(ThreadInfo thread) {
        for (String frame : thread.getStackFrames()) {
            if (EXCEPTION_INIT_PATTERN.matcher(frame).find()) {
                return true;
            }
        }
        return false;
    }

    // ========== 检测结果 ==========

    public static class DetectionResult {
        private final boolean detected;
        private final Set<String> exceptionThreadNames;

        public DetectionResult(boolean detected, Set<String> exceptionThreadNames) {
            this.detected = detected;
            this.exceptionThreadNames = Collections.unmodifiableSet(exceptionThreadNames);
        }

        public boolean isDetected() { return detected; }
        public Set<String> getExceptionThreadNames() { return exceptionThreadNames; }
    }
}
