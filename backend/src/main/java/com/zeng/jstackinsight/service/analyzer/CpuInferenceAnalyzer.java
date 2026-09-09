package com.zeng.jstackinsight.service.analyzer;

import com.zeng.jstackinsight.api.response.CpuInferenceVO;
import com.zeng.jstackinsight.api.response.ThreadStateVO;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.regex.Pattern;

/**
 * CPU 线程推测分析器 —— 前端页面与 HTML 导出共用的唯一实现。
 *
 * <h3>判定依据</h3>
 * <p>参考 fastThread 的 Athlete 模式（https://blog.fastthread.io/really-running/）：
 * 线程处于 {@code RUNNABLE} <b>不代表真的在消耗 CPU</b>。JVM 无法感知 Native 方法内部的状态，
 * 线程阻塞在 socket 读写等 Native 调用上时仍会被标记为 RUNNABLE。
 * 因此判断一个线程"是否真的在跑"，只能看<b>栈顶帧</b>——它代表线程此刻正在执行的位置。
 *
 * <h3>分类规则（按优先级）</h3>
 * <ol>
 *   <li>{@code gc}：GC / JVM 系统线程（按线程名识别）</li>
 *   <li>{@code no_stack}：无调用栈，jstack 不输出 Java 栈，无法判断</li>
 *   <li>{@code io_wait}：栈顶是已知的 Native 阻塞点（socket 读写/监听、epoll、选择器、文件 IO 等）</li>
 *   <li>{@code native}：栈顶是 Native 方法但不属于已知阻塞点（多为瞬时 Native 调用），
 *       按 fastThread 的原则不能认定为 CPU 消耗</li>
 *   <li>{@code cpu_consuming}：栈顶是 Java 方法（或已知 CPU 密集型 Native 调用），
 *       才可能真的在执行字节码消耗 CPU</li>
 * </ol>
 *
 * <p>注意：调用栈深处的 I/O 方法只作为补充说明，不参与分类 ——
 * 一个先读数据再计算的线程，其栈底同样会出现 socketRead0，但它在栈顶跑的是计算逻辑。
 *
 * <p>另：本分析强依赖完整调用栈，调用方必须传入完整线程详情而非不含 stackTrace 的线程摘要。
 *
 * @author zeng
 */
@Component
public class CpuInferenceAnalyzer {

    /** 栈顶为 Native 方法时的已知阻塞点：线程实际在等待外部资源，不消耗 CPU */
    private static final Pattern[] IO_WAIT_NATIVE_PATTERNS = {
            // Socket 读写
            Pattern.compile("socketRead0", Pattern.CASE_INSENSITIVE),
            Pattern.compile("socketWrite0", Pattern.CASE_INSENSITIVE),
            Pattern.compile("SocketDispatcher\\.read0", Pattern.CASE_INSENSITIVE),
            Pattern.compile("SocketDispatcher\\.write0", Pattern.CASE_INSENSITIVE),
            // 连接监听 / 建立
            Pattern.compile("socketAccept", Pattern.CASE_INSENSITIVE),
            Pattern.compile("accept0", Pattern.CASE_INSENSITIVE),
            Pattern.compile("socketConnect", Pattern.CASE_INSENSITIVE),
            Pattern.compile("connect0", Pattern.CASE_INSENSITIVE),
            // UDP
            Pattern.compile("receive0", Pattern.CASE_INSENSITIVE),
            Pattern.compile("send0", Pattern.CASE_INSENSITIVE),
            // I/O 多路复用
            Pattern.compile("epollWait", Pattern.CASE_INSENSITIVE),
            Pattern.compile("kevent0", Pattern.CASE_INSENSITIVE),
            Pattern.compile("poll0", Pattern.CASE_INSENSITIVE),
            Pattern.compile("pollOne", Pattern.CASE_INSENSITIVE),
            Pattern.compile("waitForSignal", Pattern.CASE_INSENSITIVE),
            // 文件 / 管道 IO
            Pattern.compile("FileDispatcherImpl\\.(read|write|force|size|truncate|lock)0", Pattern.CASE_INSENSITIVE),
            Pattern.compile("readBytes", Pattern.CASE_INSENSITIVE),
            Pattern.compile("writeBytes", Pattern.CASE_INSENSITIVE),
            Pattern.compile("available0", Pattern.CASE_INSENSITIVE),
            // 进程等待
            Pattern.compile("waitFor", Pattern.CASE_INSENSITIVE),
    };

    /** 栈顶为 Java 方法时的已知阻塞入口（选择器），语义明确不会误伤真实 CPU 消耗 */
    private static final Pattern[] IO_WAIT_JAVA_PATTERNS = {
            Pattern.compile("SelectorImpl\\.select", Pattern.CASE_INSENSITIVE),
            Pattern.compile("SelectorImpl\\.lockAndDoSelect", Pattern.CASE_INSENSITIVE),
            Pattern.compile("EPollSelectorImpl\\.doSelect", Pattern.CASE_INSENSITIVE),
            Pattern.compile("KQueueSelectorImpl\\.doSelect", Pattern.CASE_INSENSITIVE),
    };

    /** 栈顶虽是 Native 方法、但确实在消耗 CPU 的少数场景（压缩 / 校验 / 加密） */
    private static final Pattern[] CPU_INTENSIVE_NATIVE_PATTERNS = {
            Pattern.compile("Inflater\\.inflateBytes", Pattern.CASE_INSENSITIVE),
            Pattern.compile("Deflater\\.deflateBytes", Pattern.CASE_INSENSITIVE),
            Pattern.compile("CRC32\\.update", Pattern.CASE_INSENSITIVE),
            Pattern.compile("CRC32C\\.update", Pattern.CASE_INSENSITIVE),
            Pattern.compile("NativeCRC32", Pattern.CASE_INSENSITIVE),
            Pattern.compile("Adler32\\.update", Pattern.CASE_INSENSITIVE),
    };

    /** GC / JVM 系统线程名模式，大小写不敏感 */
    private static final Pattern[] GC_NAME_PATTERNS = {
            Pattern.compile("GC\\s", Pattern.CASE_INSENSITIVE),
            Pattern.compile("GC task", Pattern.CASE_INSENSITIVE),
            Pattern.compile("VM Thread", Pattern.CASE_INSENSITIVE),
            Pattern.compile("VM Periodic Task Thread", Pattern.CASE_INSENSITIVE),
            Pattern.compile("CompilerThread", Pattern.CASE_INSENSITIVE),
            Pattern.compile("ConcurrentGC", Pattern.CASE_INSENSITIVE),
            Pattern.compile("G1\\s", Pattern.CASE_INSENSITIVE),
            Pattern.compile("Paralle", Pattern.CASE_INSENSITIVE),
            Pattern.compile("\\bCMS\\b", Pattern.CASE_INSENSITIVE),
            Pattern.compile("\\bZGC\\b", Pattern.CASE_INSENSITIVE),
            Pattern.compile("Shenandoah", Pattern.CASE_INSENSITIVE),
            // jstack 中无 Java 调用栈的 JVM 内部线程
            Pattern.compile("Attach Listener", Pattern.CASE_INSENSITIVE),
            Pattern.compile("Signal Dispatcher", Pattern.CASE_INSENSITIVE),
            Pattern.compile("Service Thread", Pattern.CASE_INSENSITIVE),
            Pattern.compile("Surrogate Locker", Pattern.CASE_INSENSITIVE),
            Pattern.compile("Finalizer", Pattern.CASE_INSENSITIVE),
            Pattern.compile("Reference Handler", Pattern.CASE_INSENSITIVE),
            Pattern.compile("DestroyJavaVM", Pattern.CASE_INSENSITIVE),
            // JDWP 调试线程
            Pattern.compile("JDWP", Pattern.CASE_INSENSITIVE),
    };

    private static final Pattern NATIVE_METHOD_PATTERN =
            Pattern.compile("\\(Native Method\\)", Pattern.CASE_INSENSITIVE);

    /**
     * 对 RUNNABLE 线程做 CPU 推测分类。
     *
     * @param fullThreads 完整线程详情（必须含 stackTrace）
     * @return 推测结果（含各分类计数与明细）
     */
    public CpuInferenceVO analyze(List<ThreadStateVO.ThreadSummary> fullThreads) {
        List<CpuInferenceVO.CpuThreadRow> rows = analyzeRows(fullThreads);

        int cpuCount = 0, ioCount = 0, gcCount = 0, nativeCount = 0, noStackCount = 0;
        for (CpuInferenceVO.CpuThreadRow r : rows) {
            switch (r.getCategory()) {
                case CpuInferenceVO.CAT_IO: ioCount++; break;
                case CpuInferenceVO.CAT_GC: gcCount++; break;
                case CpuInferenceVO.CAT_NATIVE: nativeCount++; break;
                case CpuInferenceVO.CAT_NO_STACK: noStackCount++; break;
                default: cpuCount++; break;
            }
        }

        return CpuInferenceVO.builder()
                .total(rows.size())
                .cpuCount(cpuCount)
                .ioCount(ioCount)
                .gcCount(gcCount)
                .nativeCount(nativeCount)
                .noStackCount(noStackCount)
                .rows(rows)
                .build();
    }

    /**
     * 返回按「CPU 消耗 → IO 等待 → Native 未知 → GC 系统 → 无栈」排序的明细行。
     */
    public List<CpuInferenceVO.CpuThreadRow> analyzeRows(List<ThreadStateVO.ThreadSummary> fullThreads) {
        List<CpuInferenceVO.CpuThreadRow> results = new ArrayList<>();
        if (fullThreads == null || fullThreads.isEmpty()) {
            return results;
        }

        // 栈顶帧 → 线程列表，用于检测共享栈顶瓶颈（只在真正消耗 CPU 的线程间统计）
        Map<String, List<ThreadStateVO.ThreadSummary>> stackSigMap = new LinkedHashMap<>();
        for (ThreadStateVO.ThreadSummary t : fullThreads) {
            if (isRunnable(t) && hasStack(t)) {
                stackSigMap.computeIfAbsent(t.getStackTrace().get(0), k -> new ArrayList<>()).add(t);
            }
        }

        for (ThreadStateVO.ThreadSummary t : fullThreads) {
            if (!isRunnable(t)) continue;

            List<String> stack = t.getStackTrace() != null ? t.getStackTrace() : Collections.emptyList();
            int stackDepth = stack.size();
            String topFrame = stack.isEmpty() ? "(无栈帧)" : stack.get(0);
            List<String> reasons = new ArrayList<>();
            String category;

            // 1. GC / JVM 系统线程
            if (matchesAny(t.getName(), GC_NAME_PATTERNS)) {
                category = CpuInferenceVO.CAT_GC;
                reasons.add("为 GC 或 JVM 系统线程，非业务 CPU 消耗");
                results.add(row(t, category, reasons, stackDepth, topFrame));
                continue;
            }

            // 2. 无调用栈：无法判断，不能认定为 CPU 消耗
            if (stack.isEmpty()) {
                category = CpuInferenceVO.CAT_NO_STACK;
                reasons.add("无 Java 调用栈，无法判断是否消耗 CPU");
                results.add(row(t, category, reasons, stackDepth, topFrame));
                continue;
            }

            // 3. 栈顶是 Native 方法：JVM 无法感知其内部状态，只在能确认是阻塞点时才算 I/O 等待
            if (NATIVE_METHOD_PATTERN.matcher(topFrame).find()) {
                if (matchesAny(topFrame, IO_WAIT_NATIVE_PATTERNS)) {
                    category = CpuInferenceVO.CAT_IO;
                    reasons.add("RUNNABLE 但栈顶为 Native I/O 等待点，实际不消耗 CPU: " + truncate(topFrame, 70));
                } else if (matchesAny(topFrame, CPU_INTENSIVE_NATIVE_PATTERNS)) {
                    category = CpuInferenceVO.CAT_CPU;
                    reasons.add("栈顶为 CPU 密集型 Native 调用（压缩/校验），正在消耗 CPU: " + truncate(topFrame, 70));
                } else {
                    category = CpuInferenceVO.CAT_NATIVE;
                    reasons.add("栈顶为 Native 方法，JVM 无法感知其内部状态，不能认定为 CPU 消耗: "
                            + truncate(topFrame, 70));
                }
                if (category != CpuInferenceVO.CAT_CPU) {
                    results.add(row(t, category, reasons, stackDepth, topFrame));
                    continue;
                }
                results.add(row(t, category, reasons, stackDepth, topFrame));
                continue;
            }

            // 4. 栈顶是 Java 方法：确实在执行字节码。只有明确的阻塞入口（选择器）才算 I/O 等待
            if (matchesAny(topFrame, IO_WAIT_JAVA_PATTERNS)) {
                category = CpuInferenceVO.CAT_IO;
                reasons.add("RUNNABLE 但栈顶为 I/O 选择器阻塞入口，实际不消耗 CPU: " + truncate(topFrame, 70));
                results.add(row(t, category, reasons, stackDepth, topFrame));
                continue;
            }

            // 5. 栈顶是普通 Java 方法 → 才可能真的在执行代码消耗 CPU
            category = CpuInferenceVO.CAT_CPU;

            // --- 以下为附加诊断信息，不改变分类 ---
            // 死循环嫌疑（重复栈帧）
            if (stack.size() > 3) {
                Set<String> frameSet = new HashSet<>(stack);
                if (frameSet.size() < stack.size() * 0.5) {
                    reasons.add("栈帧重复率异常: " + stack.size() + " 帧中仅 " + frameSet.size()
                            + " 个唯一帧（疑似死循环）");
                }
            }

            // 超深栈
            if (stackDepth > 150) {
                reasons.add("调用栈异常深 (" + stackDepth + " 帧)，疑似深度递归或复杂调用链");
            }

            // 共享栈顶瓶颈
            List<ThreadStateVO.ThreadSummary> sameStack = stackSigMap.get(topFrame);
            if (sameStack != null && sameStack.size() > 1) {
                reasons.add("与 " + sameStack.size() + " 个线程共享相同栈顶（疑似瓶颈点）");
            }

            if (reasons.isEmpty()) {
                reasons.add("RUNNABLE 且栈顶为 Java 方法，疑似在执行代码消耗 CPU: " + truncate(topFrame, 70));
            }

            results.add(row(t, category, reasons, stackDepth, topFrame));
        }

        results.sort(Comparator.comparingInt(r -> categoryOrder(r.getCategory())));
        return results;
    }

    private CpuInferenceVO.CpuThreadRow row(ThreadStateVO.ThreadSummary t, String category,
                                            List<String> reasons, int stackDepth, String topFrame) {
        return CpuInferenceVO.CpuThreadRow.builder()
                .category(category)
                .thread(t)
                .reasons(reasons)
                .stackDepth(stackDepth)
                .topFrame(topFrame)
                .build();
    }

    private int categoryOrder(String category) {
        switch (category) {
            case CpuInferenceVO.CAT_CPU: return 0;
            case CpuInferenceVO.CAT_IO: return 1;
            case CpuInferenceVO.CAT_NATIVE: return 2;
            case CpuInferenceVO.CAT_GC: return 3;
            default: return 4;
        }
    }

    private boolean isRunnable(ThreadStateVO.ThreadSummary t) {
        return t != null && "RUNNABLE".equals(t.getState());
    }

    private boolean hasStack(ThreadStateVO.ThreadSummary t) {
        return t.getStackTrace() != null && !t.getStackTrace().isEmpty();
    }

    private boolean matchesAny(String text, Pattern[] patterns) {
        if (text == null) return false;
        for (Pattern pat : patterns) {
            if (pat.matcher(text).find()) {
                return true;
            }
        }
        return false;
    }

    private String truncate(String s, int max) {
        if (s == null) return "";
        return s.substring(0, Math.min(max, s.length()));
    }
}
