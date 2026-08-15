package com.zeng.jstackinsight.service.impl;

import com.zeng.jstackinsight.api.response.DeadlockChainVO;
import com.zeng.jstackinsight.api.response.FlameGraphVO;
import com.zeng.jstackinsight.api.response.ThreadStateVO;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import org.thymeleaf.TemplateEngine;
import org.thymeleaf.context.Context;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * HTML 导出服务 — 生成自包含的静态 HTML 报告文件。
 *
 * <p>HTML 结构与样式通过 Thymeleaf 模板（{@code templates/export/}）渲染，
 * 本类负责加载数据、执行纯 Java 分析逻辑（CPU 推测、火焰图布局计算），
 * 并将结果组装为模板上下文。
 *
 * @author zeng
 */
@Service
public class ExportService {

    @Autowired
    private ReportService reportService;

    @Autowired
    private TemplateEngine templateEngine;

    private static final Map<String, String> STATE_COLORS = new LinkedHashMap<>();
    static {
        STATE_COLORS.put("RUNNABLE", "#1677ff");
        STATE_COLORS.put("BLOCKED", "#ff4d4f");
        STATE_COLORS.put("WAITING", "#fa8c16");
        STATE_COLORS.put("TIMED_WAITING", "#8c8c8c");
        STATE_COLORS.put("TERMINATED", "#8c8c8c");
        STATE_COLORS.put("NEW", "#52c41a");
    }

    // 火焰图着色方案
    private static final Map<String, String> FLAME_COLORS = new LinkedHashMap<>();
    static {
        FLAME_COLORS.put("jdk", "#1890ff");
        FLAME_COLORS.put("spring", "#52c41a");
        FLAME_COLORS.put("app", "#fa8c16");
        FLAME_COLORS.put("other", "#bfbfbf");
    }

    // CPU 推测：已知的 Native I/O 等待方法（伪装 RUNNABLE）
    private static final Pattern[] IO_WAIT_PATTERNS = {
        Pattern.compile("socketRead0", Pattern.CASE_INSENSITIVE),
        Pattern.compile("socketWrite0", Pattern.CASE_INSENSITIVE),
        Pattern.compile("socketAccept", Pattern.CASE_INSENSITIVE),
        Pattern.compile("epollWait", Pattern.CASE_INSENSITIVE),
        Pattern.compile("poll0", Pattern.CASE_INSENSITIVE),
        Pattern.compile("pollOne", Pattern.CASE_INSENSITIVE),
        Pattern.compile("waitForSignal", Pattern.CASE_INSENSITIVE),
        Pattern.compile("socketConnect", Pattern.CASE_INSENSITIVE),
        Pattern.compile("read0", Pattern.CASE_INSENSITIVE),
        Pattern.compile("write0", Pattern.CASE_INSENSITIVE),
        Pattern.compile("available", Pattern.CASE_INSENSITIVE),
        Pattern.compile("InputStream\\.read", Pattern.CASE_INSENSITIVE),
        Pattern.compile("FileChannelImpl\\.read", Pattern.CASE_INSENSITIVE),
        Pattern.compile("FileChannelImpl\\.write", Pattern.CASE_INSENSITIVE),
    };

    // CPU 推测：GC/系统级线程名模式
    private static final Pattern[] GC_NAME_PATTERNS = {
        Pattern.compile("GC\\s"),
        Pattern.compile("GC task"),
        Pattern.compile("VM Thread"),
        Pattern.compile("CompilerThread"),
        Pattern.compile("ConcurrentGC"),
        Pattern.compile("G1"),
        Pattern.compile("Paralle"),
        Pattern.compile("CMS"),
        Pattern.compile("ZGC"),
        Pattern.compile("Shenandoah"),
    };

    private enum CpuCategory { CPU_CONSUMING, IO_WAIT, GC }

    private static class CpuThreadResult {
        final ThreadStateVO.ThreadSummary thread;
        final CpuCategory category;
        final List<String> reasons;
        final int stackDepth;
        final String topFrame;

        CpuThreadResult(ThreadStateVO.ThreadSummary thread, CpuCategory category,
                        List<String> reasons, int stackDepth, String topFrame) {
            this.thread = thread;
            this.category = category;
            this.reasons = reasons;
            this.stackDepth = stackDepth;
            this.topFrame = topFrame;
        }
    }

    /**
     * 导出完整 HTML 报告。
     *
     * @param uuid 报告 UUID
     * @return 自包含的 HTML 字符串
     */
    public String exportHtml(String uuid) throws IOException {
        // 加载数据
        ReportService.ReportSummaryVO summary = reportService.getSummary(uuid);
        ThreadStateVO threadState = reportService.getThreadStateSummary(uuid);
        DeadlockChainVO deadlocks = reportService.getDeadlocks(uuid);

        // 加载完整线程详情（含调用栈），仅读一次分桶文件，复用给堆栈分组和 CPU 推测
        List<ThreadStateVO.ThreadSummary> fullThreads;
        try {
            fullThreads = reportService.getAllThreadDetails(uuid);
        } catch (Exception e) {
            fullThreads = Collections.emptyList();
        }
        List<ReportService.StackGroupVO> stackGroups = reportService.buildStackGroups(fullThreads);

        // 构建 tid -> 完整详情的索引
        Map<Long, ThreadStateVO.ThreadSummary> tidToFull = new LinkedHashMap<>();
        for (ThreadStateVO.ThreadSummary t : fullThreads) {
            tidToFull.put(t.getTid(), t);
        }

        // CPU 推测分析
        List<CpuThreadResult> cpuResults = analyzeCpuThreads(fullThreads);

        // 火焰图数据
        FlameGraphVO flameGraph;
        try {
            flameGraph = reportService.getFlameGraph(uuid);
        } catch (Exception e) {
            flameGraph = null;
        }

        // 组装模板上下文
        Context context = new Context();
        context.setVariable("summary", summary);
        context.setVariable("exportTime", formatTime(System.currentTimeMillis()));
        context.setVariable("threadState", threadState);
        context.setVariable("deadlocks", deadlocks);
        context.setVariable("inlineCss", readResource("templates/export/static/export.css"));
        context.setVariable("inlineJs", readResource("templates/export/static/export.js"));
        context.setVariable("overview", buildOverview(threadState, deadlocks));
        context.setVariable("cpu", buildCpu(cpuResults));
        context.setVariable("flame", buildFlame(flameGraph));
        context.setVariable("threads", buildThreads(threadState, tidToFull));
        context.setVariable("stackGroups", buildStackGroups(stackGroups, threadState.getThreads().size()));

        return templateEngine.process("export/export", context);
    }

    /**
     * 读取 classpath 下的资源文件内容（用于内联 CSS/JS）。
     */
    private String readResource(String path) throws IOException {
        ClassPathResource resource = new ClassPathResource(path);
        try (InputStream in = resource.getInputStream()) {
            byte[] bytes = new byte[in.available()];
            in.read(bytes);
            return new String(bytes, StandardCharsets.UTF_8);
        }
    }

    // ================================================================
    // 概览数据组装
    // ================================================================

    private Map<String, Object> buildOverview(ThreadStateVO threadState, DeadlockChainVO deadlocks) {
        Map<String, Object> overview = new LinkedHashMap<>();

        int blocked = threadState.getStateCounts().getOrDefault("BLOCKED", 0);
        int waiting = threadState.getStateCounts().getOrDefault("WAITING", 0);
        long deadlockCount = deadlocks.isDetected() ? deadlocks.getChains().size() : 0;
        long deadlockThreadCount = deadlocks.isDetected()
                ? deadlocks.getChains().stream().flatMap(List::stream).distinct().count()
                : 0;

        overview.put("totalThreads", threadState.getTotalThreads());
        overview.put("deadlockCount", deadlockCount);
        overview.put("blockedWaiting", blocked + waiting);
        overview.put("deadlockThreadCount", deadlockThreadCount);

        // 状态分布（预计算百分比与颜色）
        List<Map<String, Object>> segments = new ArrayList<>();
        int total = threadState.getTotalThreads();
        if (total > 0) {
            for (Map.Entry<String, Integer> e : threadState.getStateCounts().entrySet()) {
                double pct = e.getValue() * 100.0 / total;
                Map<String, Object> seg = new LinkedHashMap<>();
                seg.put("state", e.getKey());
                seg.put("count", e.getValue());
                seg.put("pct", String.format(Locale.US, "%.1f", pct));
                seg.put("color", STATE_COLORS.getOrDefault(e.getKey(), "#8c8c8c"));
                seg.put("showLabel", pct >= 8);
                segments.add(seg);
            }
        }
        overview.put("stateSegments", segments);

        return overview;
    }

    // ================================================================
    // CPU 推测数据组装
    // ================================================================

    /**
     * 对 RUNNABLE 线程进行启发式 CPU 分类，与前端 CpuAnalysis 逻辑一致。
     */
    private List<CpuThreadResult> analyzeCpuThreads(List<ThreadStateVO.ThreadSummary> fullThreads) {
        List<CpuThreadResult> results = new ArrayList<>();

        // 构建栈顶帧 → 线程列表，用于检测共享瓶颈
        Map<String, List<ThreadStateVO.ThreadSummary>> stackSigMap = new LinkedHashMap<>();
        for (ThreadStateVO.ThreadSummary t : fullThreads) {
            if ("RUNNABLE".equals(t.getState()) && t.getStackTrace() != null && !t.getStackTrace().isEmpty()) {
                stackSigMap.computeIfAbsent(t.getStackTrace().get(0), k -> new ArrayList<>()).add(t);
            }
        }

        for (ThreadStateVO.ThreadSummary t : fullThreads) {
            if (!"RUNNABLE".equals(t.getState())) continue;
            List<String> stack = t.getStackTrace() != null ? t.getStackTrace() : Collections.emptyList();
            int stackDepth = stack.size();
            String topFrame = stack.isEmpty() ? "(无栈帧)" : stack.get(0);
            List<String> reasons = new ArrayList<>();
            CpuCategory category = CpuCategory.CPU_CONSUMING;

            // 检查 Native I/O 等待
            boolean isIoWait = false;
            String matchedIoFrame = null;
            for (String frame : stack) {
                for (Pattern pat : IO_WAIT_PATTERNS) {
                    if (pat.matcher(frame).find()) {
                        isIoWait = true;
                        matchedIoFrame = frame;
                        break;
                    }
                }
                if (isIoWait) break;
            }
            if (isIoWait) {
                category = CpuCategory.IO_WAIT;
                reasons.add("疑似 Native I/O 等待: " + (matchedIoFrame != null ? matchedIoFrame.substring(0, Math.min(60, matchedIoFrame.length())) : ""));
                results.add(new CpuThreadResult(t, category, reasons, stackDepth, topFrame));
                continue;
            }

            // 检查 GC 线程
            boolean isGcThread = false;
            for (Pattern pat : GC_NAME_PATTERNS) {
                if (pat.matcher(t.getName()).find()) {
                    isGcThread = true;
                    break;
                }
            }
            if (isGcThread) {
                category = CpuCategory.GC;
                reasons.add("为 GC 或 JVM 系统线程");
                results.add(new CpuThreadResult(t, category, reasons, stackDepth, topFrame));
                continue;
            }

            // 检查死循环嫌疑（重复栈帧）
            if (stack.size() > 3) {
                Set<String> frameSet = new HashSet<>(stack);
                if (frameSet.size() < stack.size() * 0.5) {
                    reasons.add("栈帧重复率异常: " + stack.size() + " 帧中仅 " + frameSet.size() + " 个唯一帧（疑似死循环）");
                }
            }

            // 检查超深栈
            if (stackDepth > 150) {
                reasons.add("调用栈异常深 (" + stackDepth + " 帧)，疑似深度递归或复杂调用链");
            }

            // 检查共享栈顶瓶颈
            List<ThreadStateVO.ThreadSummary> sameStack = stackSigMap.get(topFrame);
            if (sameStack != null && sameStack.size() > 1) {
                reasons.add("与 " + sameStack.size() + " 个线程共享相同栈顶（疑似瓶颈点）");
            }

            if (reasons.isEmpty()) {
                reasons.add("RUNNABLE 状态，栈顶: " + topFrame.substring(0, Math.min(80, topFrame.length())));
            }

            results.add(new CpuThreadResult(t, category, reasons, stackDepth, topFrame));
        }
        return results;
    }

    private Map<String, Object> buildCpu(List<CpuThreadResult> results) {
        Map<String, Object> cpu = new LinkedHashMap<>();

        long cpuCount = results.stream().filter(r -> r.category == CpuCategory.CPU_CONSUMING).count();
        long ioCount = results.stream().filter(r -> r.category == CpuCategory.IO_WAIT).count();
        long gcCount = results.stream().filter(r -> r.category == CpuCategory.GC).count();

        cpu.put("total", results.size());
        cpu.put("cpuCount", cpuCount);
        cpu.put("ioCount", ioCount);
        cpu.put("gcCount", gcCount);

        // 排序：CPU 消耗优先，其次 IO 等待，最后 GC 系统线程
        List<CpuThreadResult> sorted = new ArrayList<>(results);
        sorted.sort(Comparator.comparingInt(r -> categoryOrder(r.category)));

        List<Map<String, Object>> rows = new ArrayList<>();
        for (CpuThreadResult r : sorted) {
            Map<String, Object> row = new LinkedHashMap<>();
            switch (r.category) {
                case CPU_CONSUMING:
                    row.put("catLabel", "CPU 消耗");
                    row.put("catBg", "#ff4d4f");
                    row.put("rowColor", "#fff2f0");
                    break;
                case IO_WAIT:
                    row.put("catLabel", "IO 等待");
                    row.put("catBg", "#8c8c8c");
                    row.put("rowColor", "#fafafa");
                    break;
                default:
                    row.put("catLabel", "GC 系统");
                    row.put("catBg", "#13c2c2");
                    row.put("rowColor", "#e6fffb");
                    break;
            }
            row.put("category", r.category.name());
            row.put("thread", r.thread);
            row.put("reasons", r.reasons);
            row.put("stackDepth", r.stackDepth);
            row.put("topFrame", r.topFrame.substring(0, Math.min(100, r.topFrame.length())));
            rows.add(row);
        }
        cpu.put("results", rows);

        return cpu;
    }

    /** CPU 分类的展示优先级：CPU 消耗 → IO 等待 → GC 系统。 */
    private int categoryOrder(CpuCategory category) {
        switch (category) {
            case CPU_CONSUMING: return 0;
            case IO_WAIT: return 1;
            default: return 2;
        }
    }

    // ================================================================
    // 火焰图数据组装（扁平化布局）
    // ================================================================

    private Map<String, Object> buildFlame(FlameGraphVO flameGraph) {
        Map<String, Object> flame = new LinkedHashMap<>();

        boolean empty = flameGraph == null || flameGraph.getRoot() == null
                || flameGraph.getRoot().getChildren() == null
                || flameGraph.getRoot().getChildren().isEmpty();
        flame.put("isEmpty", empty);

        // 图例
        List<Map<String, String>> legend = new ArrayList<>();
        for (Map.Entry<String, String> e : FLAME_COLORS.entrySet()) {
            Map<String, String> item = new LinkedHashMap<>();
            item.put("color", e.getValue());
            item.put("label", legendLabel(e.getKey()));
            legend.add(item);
        }
        flame.put("legend", legend);

        if (empty) {
            flame.put("width", 0);
            flame.put("height", 0);
            flame.put("nodes", Collections.emptyList());
            flame.put("labels", Collections.emptyList());
            return flame;
        }

        FlameGraphVO.FlameNode root = flameGraph.getRoot();
        int maxDepth = calcMaxDepth(root, 0);
        int rowHeight = Math.max(18, Math.min(36, 600 / (maxDepth + 1)));
        int width = 1200;
        int height = rowHeight * (maxDepth + 1);
        int totalValue = calcTotalValue(root);

        // 扁平化所有节点为矩形列表
        List<Map<String, Object>> nodes = new ArrayList<>();
        List<Map<String, Object>> labels = new ArrayList<>();
        if (totalValue > 0) {
            flattenFlameNode(root, 1, 0, width, rowHeight, totalValue, nodes, labels);
        }

        flame.put("width", width);
        flame.put("height", height);
        flame.put("nodes", nodes);
        flame.put("labels", labels);
        return flame;
    }

    private String legendLabel(String key) {
        switch (key) {
            case "jdk": return "JDK";
            case "spring": return "Spring";
            case "app": return "应用代码";
            default: return "其他";
        }
    }

    private int calcMaxDepth(FlameGraphVO.FlameNode node, int depth) {
        if (node == null) return depth;
        if (node.getChildren() == null || node.getChildren().isEmpty()) {
            return depth;
        }
        int max = depth;
        for (FlameGraphVO.FlameNode child : node.getChildren()) {
            max = Math.max(max, calcMaxDepth(child, depth + 1));
        }
        return max;
    }

    /**
     * 计算节点的总 value：叶子节点用自身 value，父节点为子节点之和。
     */
    private int calcTotalValue(FlameGraphVO.FlameNode node) {
        if (node == null) return 0;
        if (node.getChildren() == null || node.getChildren().isEmpty()) {
            return node.getValue();
        }
        int sum = 0;
        for (FlameGraphVO.FlameNode child : node.getChildren()) {
            sum += calcTotalValue(child);
        }
        return sum > 0 ? sum : node.getValue();
    }

    /**
     * 递归遍历火焰图树，将每个节点扁平化为一个矩形（含几何信息）与文字标签。
     */
    private void flattenFlameNode(FlameGraphVO.FlameNode node, int depth, double x0,
                                  double totalWidth, int rowHeight, int totalValue,
                                  List<Map<String, Object>> nodes, List<Map<String, Object>> labels) {
        List<FlameGraphVO.FlameNode> children = node.getChildren();
        if (children == null || children.isEmpty()) {
            return;
        }

        // 按 value 降序排序，与前端 d3 root.sort 一致（大块在左）
        List<FlameGraphVO.FlameNode> sortedChildren = new ArrayList<>(children);
        sortedChildren.sort((a, b) -> Integer.compare(calcTotalValue(b), calcTotalValue(a)));

        double y = depth * rowHeight;
        double cursor = x0;
        for (FlameGraphVO.FlameNode child : sortedChildren) {
            int childValue = calcTotalValue(child);
            double w = totalValue > 0 ? totalWidth * childValue / totalValue : 0;
            if (w < 1) w = 1;

            String color = FLAME_COLORS.getOrDefault(child.getColorCategory(), FLAME_COLORS.get("other"));
            String sig = child.getFullSignature() != null ? child.getFullSignature()
                    : (child.getName() != null ? child.getName() : "");

            Map<String, Object> rect = new LinkedHashMap<>();
            rect.put("x", fmt(cursor));
            rect.put("y", fmt(y));
            rect.put("width", fmt(Math.max(0, w - 1)));
            rect.put("height", Math.max(0, rowHeight - 1));
            rect.put("color", color);
            rect.put("sig", sig);
            rect.put("count", childValue);
            nodes.add(rect);

            // 文字标签（宽度足够时显示）
            String name = child.getName() != null ? child.getName() : "";
            int maxLen = (int) (w / 6);
            if (w >= 30 && maxLen > 0) {
                String label = name.length() > maxLen ? name.substring(0, Math.max(0, maxLen - 2)) + ".." : name;
                Map<String, Object> text = new LinkedHashMap<>();
                text.put("x", fmt(cursor + 4));
                text.put("y", fmt(y + rowHeight / 2.0));
                text.put("fontSize", Math.min(12, rowHeight - 6));
                text.put("text", label);
                labels.add(text);
            }

            // 递归子节点
            flattenFlameNode(child, depth + 1, cursor, w, rowHeight, childValue, nodes, labels);

            cursor += w;
        }
    }

    private String fmt(double d) {
        return String.format(Locale.US, "%.1f", d);
    }

    // ================================================================
    // 线程列表数据组装
    // ================================================================

    private Map<String, Object> buildThreads(ThreadStateVO threadState,
                                             Map<Long, ThreadStateVO.ThreadSummary> tidToFull) {
        Map<String, Object> threads = new LinkedHashMap<>();

        List<Map<String, Object>> rows = new ArrayList<>();
        for (ThreadStateVO.ThreadSummary t : threadState.getThreads()) {
            ThreadStateVO.ThreadSummary full = tidToFull.get(t.getTid());

            String rowClass = "";
            if (t.isInDeadlock()) rowClass = " deadlock-row";
            else if (t.isFinalizerTrapped()) rowClass = " finalizer-row";
            else if (t.isThrowingException()) rowClass = " exception-row";

            String stateColor = STATE_COLORS.getOrDefault(t.getState(), "#8c8c8c");
            if (t.isInDeadlock()) stateColor = "#ff4d4f";
            else if (t.isFinalizerTrapped()) stateColor = "#fa8c16";

            boolean hasStack = full != null && full.getStackTrace() != null && !full.getStackTrace().isEmpty();
            int stackDepth = full != null ? (full.getStackTrace() != null ? full.getStackTrace().size() : 0) : -1;

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("rowClass", rowClass);
            row.put("hasStack", hasStack);
            row.put("inDeadlock", t.isInDeadlock());
            row.put("finalizerTrapped", t.isFinalizerTrapped());
            row.put("throwingException", t.isThrowingException());
            row.put("name", t.getName());
            row.put("nid", t.getNid());
            row.put("state", t.getState());
            row.put("stateColor", stateColor);
            row.put("waitingOnLock", t.getWaitingOnLock());
            row.put("stackDepth", stackDepth >= 0 ? String.valueOf(stackDepth) : "?");
            row.put("stackHtml", hasStack ? buildStackHtml(full) : "");
            rows.add(row);
        }
        threads.put("rows", rows);

        return threads;
    }

    /**
     * 构建线程调用栈的 HTML（含颜色 class 与转义），行间以换行符分隔，
     * 由模板通过 {@code th:utext} 原样输出，配合 {@code white-space:pre} 渲染。
     */
    private String buildStackHtml(ThreadStateVO.ThreadSummary t) {
        StringBuilder sb = new StringBuilder();

        List<String> frames = t.getStackTrace();
        boolean hasWaiting = t.getWaitingOnLock() != null && !t.getWaitingOnLock().isEmpty();
        boolean waitingInserted = false;

        for (int i = 0; i < frames.size(); i++) {
            sb.append("<span class=\"stack-line-at\">at ").append(escapeHtml(frames.get(i))).append("</span>\n");

            if (!waitingInserted && hasWaiting && i == 0) {
                waitingInserted = true;
                String lockType = "BLOCKED".equals(t.getState()) ? "waiting to lock" : "parking to wait for";
                sb.append("<span class=\"stack-line-waiting\">- ").append(lockType)
                  .append(" &lt;").append(escapeHtml(t.getWaitingOnLock())).append("&gt;");
                if (t.getWaitingOnLockClass() != null) {
                    sb.append(" (a ").append(escapeHtml(t.getWaitingOnLockClass())).append(")");
                }
                sb.append("</span>\n");
            }
        }

        if (t.getLockedMonitors() != null) {
            for (int i = 0; i < t.getLockedMonitors().size(); i++) {
                sb.append("<span class=\"stack-line-locked\">- locked &lt;")
                  .append(escapeHtml(t.getLockedMonitors().get(i))).append("&gt;");
                if (t.getLockedMonitorClasses() != null && i < t.getLockedMonitorClasses().size()) {
                    sb.append(" (a ").append(escapeHtml(t.getLockedMonitorClasses().get(i))).append(")");
                }
                sb.append("</span>\n");
            }
        }

        return sb.toString();
    }

    // ================================================================
    // 相同堆栈数据组装
    // ================================================================

    private List<Map<String, Object>> buildStackGroups(List<ReportService.StackGroupVO> groups, int totalThreads) {
        List<Map<String, Object>> result = new ArrayList<>();

        for (ReportService.StackGroupVO g : groups) {
            double pct = totalThreads > 0 ? g.getCount() * 100.0 / totalThreads : 0;
            String countColor = g.getCount() > totalThreads * 0.3 ? "#ff4d4f"
                    : g.getCount() > 10 ? "#fa8c16" : "#52c41a";

            List<Map<String, Object>> stateTags = new ArrayList<>();
            for (Map.Entry<String, Long> e : g.getStates().entrySet()) {
                Map<String, Object> tag = new LinkedHashMap<>();
                tag.put("state", e.getKey());
                tag.put("count", e.getValue());
                tag.put("color", STATE_COLORS.getOrDefault(e.getKey(), "#8c8c8c"));
                stateTags.add(tag);
            }

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("count", g.getCount());
            row.put("countColor", countColor);
            row.put("pct", String.format(Locale.US, "%.1f", pct));
            row.put("firstFrame", g.getFirstFrame());
            row.put("stateTags", stateTags);
            row.put("sampleNames", g.getAllThreadNames().stream().limit(3).collect(Collectors.joining(", ")));
            result.add(row);
        }

        return result;
    }

    // ================================================================
    // 辅助方法
    // ================================================================

    private String escapeHtml(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    /** 将毫秒时间戳格式化为「yyyy-MM-dd HH:mm:ss」字符串。 */
    private String formatTime(long millis) {
        return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date(millis));
    }
}
