package com.zeng.jstackinsight.service.impl;

import com.zeng.jstackinsight.api.response.DeadlockChainVO;
import com.zeng.jstackinsight.api.response.ThreadStateVO;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * HTML 导出服务 — 生成自包含的静态 HTML 报告文件。
 *
 * <p>不依赖前端渲染栈，直接在后端拼装 HTML + 内联 CSS/JS，
 * 用户下载后可直接用浏览器打开。
 *
 * @author zeng
 */
@Service
public class ExportService {

    @Autowired
    private ReportService reportService;

    private static final Map<String, String> STATE_COLORS = new LinkedHashMap<>();
    static {
        STATE_COLORS.put("RUNNABLE", "#1677ff");
        STATE_COLORS.put("BLOCKED", "#ff4d4f");
        STATE_COLORS.put("WAITING", "#fa8c16");
        STATE_COLORS.put("TIMED_WAITING", "#8c8c8c");
        STATE_COLORS.put("TERMINATED", "#8c8c8c");
        STATE_COLORS.put("NEW", "#52c41a");
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

        StringBuilder html = new StringBuilder();

        html.append("<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n");
        html.append("<meta charset=\"utf-8\">\n");
        html.append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n");
        html.append("<title>JStack Insight - ").append(escapeHtml(summary.getFilename())).append("</title>\n");
        html.append("<style>\n");
        html.append(renderCss());
        html.append("</style>\n");
        html.append("</head>\n<body>\n");

        // ========== 头部 ==========
        html.append(renderHeader(summary));

        // ========== Tab 导航 ==========
        html.append(renderTabs());

        // ========== 概览 Tab ==========
        html.append("<div id=\"tab-overview\" class=\"tab-content active\">\n");
        html.append(renderOverview(threadState, deadlocks));
        html.append("</div>\n");

        // ========== 死锁 Tab ==========
        html.append("<div id=\"tab-deadlocks\" class=\"tab-content\">\n");
        html.append(renderDeadlocks(deadlocks));
        html.append("</div>\n");

        // ========== CPU 推测 Tab ==========
        html.append("<div id=\"tab-cpu-inference\" class=\"tab-content\">\n");
        html.append(renderCpuInference(cpuResults));
        html.append("</div>\n");

        // ========== 线程列表 Tab ==========
        html.append("<div id=\"tab-threads\" class=\"tab-content\">\n");
        html.append(renderThreadList(threadState, tidToFull));
        html.append("</div>\n");

        // ========== 相同堆栈 Tab ==========
        html.append("<div id=\"tab-stack-groups\" class=\"tab-content\">\n");
        html.append(renderStackGroups(stackGroups, threadState.getThreads().size()));
        html.append("</div>\n");

        html.append("<script>\n");
        html.append(renderJs());
        html.append("</script>\n");

        html.append("</body>\n</html>");
        return html.toString();
    }

    // ================================================================
    // CSS
    // ================================================================

    private String renderCss() {
        return
            "* { margin:0; padding:0; box-sizing:border-box; }\n" +
            "body { font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:#f5f5f5; color:#1a1a1a; line-height:1.6; }\n" +
            ".header { background:#fff; padding:10px 24px; border-bottom:1px solid #e8e8e8; display:flex; align-items:center; gap:12px; }\n" +
            ".header h1 { font-size:15px; color:#1a1a1a; margin:0; display:flex; align-items:center; gap:8px; white-space:nowrap; }\n" +
            ".header h1 .logo { font-size:18px; }\n" +
            ".header .meta { font-size:12px; color:#999; }\n" +
            ".header .badge { display:inline-block; padding:2px 10px; border-radius:10px; font-size:11px; font-weight:600; margin-left:8px; }\n" +
            ".badge-deadlock { background:#ff4d4f; color:#fff; }\n" +
            ".tabs { display:flex; gap:0; background:#fff; border-bottom:1px solid #e8e8e8; padding:0 32px; position:sticky; top:0; z-index:100; }\n" +
            ".tab { padding:12px 20px; cursor:pointer; font-size:14px; color:#666; border-bottom:2px solid transparent; transition:all 0.2s; user-select:none; }\n" +
            ".tab:hover { color:#1677ff; }\n" +
            ".tab.active { color:#1677ff; border-bottom-color:#1677ff; font-weight:600; }\n" +
            ".tab-content { display:none; padding:24px 32px; }\n" +
            ".tab-content.active { display:block; }\n" +
            ".card { background:#fff; border-radius:8px; padding:20px; margin-bottom:16px; box-shadow:0 1px 2px rgba(0,0,0,0.06); }\n" +
            ".card h2 { font-size:16px; margin-bottom:16px; padding-bottom:10px; border-bottom:1px solid #f0f0f0; }\n" +
            ".stats { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:20px; }\n" +
            ".stat { flex:1; min-width:140px; background:#fafafa; border-radius:8px; padding:16px; text-align:center; }\n" +
            ".stat .num { font-size:28px; font-weight:700; }\n" +
            ".stat .label { font-size:12px; color:#999; margin-top:4px; }\n" +
            ".stat.danger .num { color:#ff4d4f; }\n" +
            ".stat.warning .num { color:#fa8c16; }\n" +
            ".stat.info .num { color:#1677ff; }\n" +
            ".state-bar { display:flex; height:32px; border-radius:6px; overflow:hidden; margin-bottom:12px; }\n" +
            ".state-seg { display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:600; color:#fff; transition:width 0.3s; }\n" +
            ".state-legend { display:flex; gap:16px; flex-wrap:wrap; }\n" +
            ".state-legend-item { display:flex; align-items:center; gap:6px; font-size:12px; }\n" +
            ".state-dot { width:10px; height:10px; border-radius:2px; }\n" +
            "table { width:100%; border-collapse:collapse; font-size:13px; }\n" +
            "th, td { padding:8px 12px; text-align:left; border-bottom:1px solid #f0f0f0; }\n" +
            "th { background:#fafafa; font-weight:600; color:#666; position:sticky; top:0; white-space:nowrap; }\n" +
            "tr:hover td { background:#fafafa; }\n" +
            ".tag { display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; }\n" +
            ".deadlock-row td { background:#fff2f0 !important; }\n" +
            ".finalizer-row td { background:#fff7e6 !important; }\n" +
            ".exception-row td { background:#fff1f0 !important; }\n" +
            ".stack-pre { background:#1e1e1e; color:#d4d4d4; padding:16px; border-radius:8px; font-size:12px; line-height:1.8; font-family:'Fira Code','Consolas','Courier New',monospace; max-height:400px; overflow:auto; white-space:pre; }\n" +
            ".stack-line-at { color:#dcdcaa; }\n" +
            ".stack-line-waiting { color:#ce9178; }\n" +
            ".stack-line-locked { color:#569cd6; }\n" +
            ".chain-card { border:1px solid #ffccc7; border-radius:8px; padding:16px; margin-bottom:12px; background:#fff2f0; }\n" +
            ".chain-flow { display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:13px; margin-bottom:12px; }\n" +
            ".chain-node { padding:4px 12px; border-radius:6px; font-family:monospace; font-weight:600; background:#ff4d4f; color:#fff; }\n" +
            ".chain-arrow { color:#ff4d4f; font-weight:700; font-size:16px; }\n" +
            ".search-box { width:280px; padding:8px 12px; border:1px solid #d9d9d9; border-radius:6px; font-size:13px; margin-bottom:12px; outline:none; }\n" +
            ".search-box:focus { border-color:#1677ff; box-shadow:0 0 0 2px rgba(22,119,255,0.1); }\n" +
            ".expand-btn { cursor:pointer; color:#1677ff; font-size:12px; user-select:none; }\n" +
            ".expand-btn:hover { color:#0958d9; }\n" +
            ".detail-row { display:none; }\n" +
            ".detail-row.show { display:table-row; }\n" +
            ".detail-row td { padding:0 12px 12px 48px; }\n" +
            ".alert { padding:12px 16px; border-radius:8px; margin-bottom:16px; font-size:14px; }\n" +
            ".alert-danger { background:#fff2f0; border:1px solid #ffccc7; color:#cf1322; }\n" +
            ".alert-success { background:#f6ffed; border:1px solid #b7eb8f; color:#389e0d; }\n" +
            ".alert-info { background:#e6f4ff; border:1px solid #91caff; color:#0958d9; }\n" +
            ".group-bar { height:8px; border-radius:4px; background:#f0f0f0; margin:4px 0; overflow:hidden; }\n" +
            ".group-bar-fill { height:100%; border-radius:4px; background:#1677ff; transition:width 0.3s; }\n" +
            "@media print { body { background:#fff; } .tabs { display:none; } .tab-content { display:block !important; padding:12px 0; } }\n";
    }

    // ================================================================
    // JS
    // ================================================================

    private String renderJs() {
        return
            "function switchTab(name) {\n" +
            "  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));\n" +
            "  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));\n" +
            "  document.querySelector('.tab[data-tab=\"' + name + '\"]').classList.add('active');\n" +
            "  document.getElementById('tab-' + name).classList.add('active');\n" +
            "}\n" +
            "function toggleDetail(btn, idx) {\n" +
            "  var row = document.getElementById('detail-' + idx);\n" +
            "  if (row.classList.contains('show')) {\n" +
            "    row.classList.remove('show');\n" +
            "    btn.textContent = '\\u25B6 \\u5C55\\u5F00';\n" +
            "  } else {\n" +
            "    row.classList.add('show');\n" +
            "    btn.textContent = '\\u25BC \\u6536\\u8D77';\n" +
            "  }\n" +
            "}\n" +
            "function filterThreads() {\n" +
            "  var q = document.getElementById('thread-search').value.toLowerCase();\n" +
            "  document.querySelectorAll('#threads-tbody tr.row-main').forEach(function(row) {\n" +
            "    var text = row.textContent.toLowerCase();\n" +
            "    row.style.display = q ? (text.includes(q) ? '' : 'none') : '';\n" +
            "    var detailRow = row.nextElementSibling;\n" +
            "    if (detailRow && detailRow.classList.contains('detail-row')) {\n" +
            "      detailRow.style.display = row.style.display;\n" +
            "    }\n" +
            "  });\n" +
            "}\n" +
            "function filterGroups() {\n" +
            "  var q = document.getElementById('group-search').value.toLowerCase();\n" +
            "  document.querySelectorAll('#groups-tbody tr').forEach(function(row) {\n" +
            "    row.style.display = q ? (row.textContent.toLowerCase().includes(q) ? '' : 'none') : '';\n" +
            "  });\n" +
            "}\n";
    }

    // ================================================================
    // 头部
    // ================================================================

    private String renderHeader(ReportService.ReportSummaryVO summary) {
        StringBuilder sb = new StringBuilder();
        sb.append("<div class=\"header\">\n");
        sb.append("  <h1><span class=\"logo\">🔍</span> JStack Insight</h1>\n");
        sb.append("  <div class=\"meta\">\n");
        sb.append("    <span style=\"color:#1a1a1a;font-weight:500;\">").append(escapeHtml(summary.getFilename())).append("</span>\n");
        sb.append("    &nbsp;·&nbsp; ").append(summary.getTotalThreads()).append(" 线程");
        if (summary.isHasDeadlock()) {
            sb.append("    <span class=\"badge badge-deadlock\">死锁</span>\n");
        }
        sb.append("  </div>\n");
        sb.append("</div>\n");
        return sb.toString();
    }

    // ================================================================
    // Tab 导航
    // ================================================================

    private String renderTabs() {
        return
            "<div class=\"tabs\">\n" +
            "  <div class=\"tab active\" data-tab=\"overview\" onclick=\"switchTab('overview')\">概览</div>\n" +
            "  <div class=\"tab\" data-tab=\"deadlocks\" onclick=\"switchTab('deadlocks')\">死锁分析</div>\n" +
            "  <div class=\"tab\" data-tab=\"cpu-inference\" onclick=\"switchTab('cpu-inference')\">CPU 推测</div>\n" +
            "  <div class=\"tab\" data-tab=\"threads\" onclick=\"switchTab('threads')\">线程列表</div>\n" +
            "  <div class=\"tab\" data-tab=\"stack-groups\" onclick=\"switchTab('stack-groups')\">相同堆栈</div>\n" +
            "</div>\n";
    }

    // ================================================================
    // 概览
    // ================================================================

    private String renderOverview(ThreadStateVO threadState, DeadlockChainVO deadlocks) {
        StringBuilder sb = new StringBuilder();

        // 指标卡
        sb.append("<div class=\"card\">\n<h2>报告概览</h2>\n<div class=\"stats\">\n");
        sb.append(statCard("线程总数", String.valueOf(threadState.getTotalThreads()), "info"));
        int blocked = threadState.getStateCounts().getOrDefault("BLOCKED", 0);
        int waiting = threadState.getStateCounts().getOrDefault("WAITING", 0);
        long deadlockCount = deadlocks.isDetected() ? deadlocks.getChains().size() : 0;
        sb.append(statCard("死锁链路", String.valueOf(deadlockCount), deadlockCount > 0 ? "danger" : "info"));
        sb.append(statCard("BLOCKED + WAITING", String.valueOf(blocked + waiting), (blocked + waiting) > 0 ? "warning" : "info"));
        sb.append("</div>\n");

        // 死锁警告
        if (deadlocks.isDetected()) {
            sb.append("<div class=\"alert alert-danger\"><strong>警告：</strong>检测到 ").append(deadlockCount)
              .append(" 条死锁链路，涉及 ").append(deadlocks.getChains().stream().flatMap(List::stream).distinct().count())
              .append(" 个线程</div>\n");
        }

        // 状态分布
        sb.append("<h3 style=\"font-size:14px;margin-bottom:12px;\">线程状态分布</h3>\n");
        long total = threadState.getTotalThreads();
        if (total > 0) {
            sb.append("<div class=\"state-bar\">\n");
            for (Map.Entry<String, Integer> e : threadState.getStateCounts().entrySet()) {
                double pct = e.getValue() * 100.0 / total;
                String color = STATE_COLORS.getOrDefault(e.getKey(), "#8c8c8c");
                sb.append(String.format("  <div class=\"state-seg\" style=\"width:%.1f%%;background:%s\" title=\"%s: %d\">%s</div>\n",
                        pct, color, e.getKey(), e.getValue(), pct >= 8 ? e.getKey() : ""));
            }
            sb.append("</div>\n");
            sb.append("<div class=\"state-legend\">\n");
            for (Map.Entry<String, Integer> e : threadState.getStateCounts().entrySet()) {
                String color = STATE_COLORS.getOrDefault(e.getKey(), "#8c8c8c");
                sb.append(String.format("  <div class=\"state-legend-item\"><div class=\"state-dot\" style=\"background:%s\"></div>%s: %d</div>\n",
                        color, e.getKey(), e.getValue()));
            }
            sb.append("</div>\n");
        }

        sb.append("</div>\n");
        return sb.toString();
    }

    // ================================================================
    // 死锁分析
    // ================================================================

    private String renderDeadlocks(DeadlockChainVO deadlocks) {
        StringBuilder sb = new StringBuilder();
        sb.append("<div class=\"card\">\n<h2>死锁检测</h2>\n");

        if (!deadlocks.isDetected()) {
            sb.append("<div class=\"alert alert-success\">未检测到死锁 ✓</div>\n");
            sb.append("</div>\n");
            return sb.toString();
        }

        sb.append("<div class=\"alert alert-danger\">检测到 <strong>").append(deadlocks.getChains().size())
          .append("</strong> 条死锁链路</div>\n");

        for (int i = 0; i < deadlocks.getChains().size(); i++) {
            List<String> chain = deadlocks.getChains().get(i);
            sb.append("<div class=\"chain-card\">\n");
            sb.append("<h3 style=\"font-size:14px;margin-bottom:10px;\">死锁链路 #").append(i + 1).append("</h3>\n");
            sb.append("<div class=\"chain-flow\">\n");
            for (int j = 0; j < chain.size(); j++) {
                if (j > 0) {
                    sb.append("<span class=\"chain-arrow\">→</span>");
                }
                sb.append("<span class=\"chain-node\">").append(escapeHtml(chain.get(j))).append("</span>");
            }
            sb.append("<span class=\"chain-arrow\">↻</span>\n");
            sb.append("</div>\n");

            if (i < deadlocks.getDescriptions().size()) {
                sb.append("<p style=\"font-size:13px;color:#666;\">").append(escapeHtml(deadlocks.getDescriptions().get(i))).append("</p>\n");
            }
            sb.append("</div>\n");
        }

        sb.append("</div>\n");
        return sb.toString();
    }

    // ================================================================
    // 线程列表
    // ================================================================

    private String renderThreadList(ThreadStateVO threadState,
                                     Map<Long, ThreadStateVO.ThreadSummary> tidToFull) {
        StringBuilder sb = new StringBuilder();
        sb.append("<div class=\"card\">\n<h2>线程列表 (").append(threadState.getTotalThreads()).append(")</h2>\n");
        sb.append("<input class=\"search-box\" id=\"thread-search\" placeholder=\"搜索线程名/状态/栈帧...\" oninput=\"filterThreads()\">\n");

        sb.append("<div style=\"max-height:70vh;overflow:auto;\">\n");
        sb.append("<table>\n<thead><tr>");
        sb.append("<th></th><th>线程名</th><th>nid</th><th>状态</th><th>等待锁</th><th>栈深</th></tr></thead>\n");
        sb.append("<tbody id=\"threads-tbody\">\n");

        List<ThreadStateVO.ThreadSummary> summaries = threadState.getThreads();
        for (int i = 0; i < summaries.size(); i++) {
            ThreadStateVO.ThreadSummary t = summaries.get(i);
            ThreadStateVO.ThreadSummary full = tidToFull.get(t.getTid());

            String rowClass = "";
            if (t.isInDeadlock()) rowClass = " deadlock-row";
            else if (t.isFinalizerTrapped()) rowClass = " finalizer-row";
            else if (t.isThrowingException()) rowClass = " exception-row";

            String stateColor = STATE_COLORS.getOrDefault(t.getState(), "#8c8c8c");
            if (t.isInDeadlock()) stateColor = "#ff4d4f";
            else if (t.isFinalizerTrapped()) stateColor = "#fa8c16";

            sb.append("<tr class=\"row-main").append(rowClass).append("\">\n");
            sb.append("<td>");
            if (full != null && full.getStackTrace() != null && !full.getStackTrace().isEmpty()) {
                sb.append("<span class=\"expand-btn\" onclick=\"toggleDetail(this,").append(i).append(")\">▶ 展开</span>");
            }
            sb.append("</td>\n");
            sb.append("<td>");
            if (t.isInDeadlock()) sb.append("🐛 ");
            else if (t.isFinalizerTrapped()) sb.append("⚠ ");
            else if (t.isThrowingException()) sb.append("⚠ ");
            sb.append("<code>").append(escapeHtml(t.getName())).append("</code></td>\n");
            sb.append("<td style=\"font-family:monospace;font-size:12px;color:#999;\">").append(t.getNid() != null ? t.getNid() : "-").append("</td>\n");
            sb.append("<td><span class=\"tag\" style=\"background:").append(stateColor).append(";color:#fff;\">").append(t.getState()).append("</span></td>\n");
            sb.append("<td style=\"font-family:monospace;font-size:11px;\">").append(t.getWaitingOnLock() != null ? escapeHtml(t.getWaitingOnLock()) : "-").append("</td>\n");
            sb.append("<td>").append(full != null ? full.getStackTrace() != null ? full.getStackTrace().size() : 0 : "?").append("</td>\n");
            sb.append("</tr>\n");

            // 详情行（完整调用栈）
            if (full != null && full.getStackTrace() != null && !full.getStackTrace().isEmpty()) {
                sb.append("<tr class=\"detail-row\" id=\"detail-").append(i).append("\"><td colspan=\"6\">\n");
                sb.append(renderStackTrace(full));
                sb.append("</td></tr>\n");
            }
        }

        sb.append("</tbody></table>\n");
        sb.append("</div>\n");
        sb.append("</div>\n");
        return sb.toString();
    }

    private String renderStackTrace(ThreadStateVO.ThreadSummary t) {
        StringBuilder sb = new StringBuilder();
        sb.append("<div class=\"stack-pre\">");

        List<String> frames = t.getStackTrace();
        boolean hasWaiting = t.getWaitingOnLock() != null && !t.getWaitingOnLock().isEmpty();
        boolean waitingInserted = false;

        for (int i = 0; i < frames.size(); i++) {
            sb.append("<span class=\"stack-line-at\">at ").append(escapeHtml(frames.get(i))).append("</span>\n");
            if (!waitingInserted && hasWaiting && i == 0) {
                waitingInserted = true;
                String lockType = "BLOCKED".equals(t.getState()) ? "waiting to lock" : "parking to wait for";
                sb.append("<span class=\"stack-line-waiting\">- ").append(lockType).append(" &lt;").append(escapeHtml(t.getWaitingOnLock())).append("&gt;");
                if (t.getWaitingOnLockClass() != null) {
                    sb.append(" (a ").append(escapeHtml(t.getWaitingOnLockClass())).append(")");
                }
                sb.append("</span>\n");
            }
        }

        if (t.getLockedMonitors() != null) {
            for (int i = 0; i < t.getLockedMonitors().size(); i++) {
                sb.append("<span class=\"stack-line-locked\">- locked &lt;").append(escapeHtml(t.getLockedMonitors().get(i))).append("&gt;");
                if (t.getLockedMonitorClasses() != null && i < t.getLockedMonitorClasses().size()) {
                    sb.append(" (a ").append(escapeHtml(t.getLockedMonitorClasses().get(i))).append(")");
                }
                sb.append("</span>\n");
            }
        }

        sb.append("</div>\n");
        return sb.toString();
    }

    // ================================================================
    // CPU 线程推测
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

    private String renderCpuInference(List<CpuThreadResult> results) {
        StringBuilder sb = new StringBuilder();
        sb.append("<div class=\"card\">\n<h2>CPU 线程推测</h2>\n");

        long cpuCount = results.stream().filter(r -> r.category == CpuCategory.CPU_CONSUMING).count();
        long ioCount = results.stream().filter(r -> r.category == CpuCategory.IO_WAIT).count();
        long gcCount = results.stream().filter(r -> r.category == CpuCategory.GC).count();

        sb.append("<div class=\"stats\">\n");
        sb.append(statCard("RUNNABLE 总数", String.valueOf(results.size()), "info"));
        sb.append(statCard("疑似 CPU 消耗", String.valueOf(cpuCount), cpuCount > 0 ? "danger" : "info"));
        sb.append(statCard("IO 等待", String.valueOf(ioCount), "info"));
        sb.append(statCard("GC 系统线程", String.valueOf(gcCount), "info"));
        sb.append("</div>\n");

        if (cpuCount > 0) {
            sb.append("<div class=\"alert alert-danger\">⚠ 检测到 ").append(cpuCount)
              .append(" 个疑似 CPU 消耗线程，建议进一步使用 top -H 进行精准采集</div>\n");
        }

        // 默认只显示 cpu_consuming
        sb.append("<div style=\"max-height:70vh;overflow:auto;\">\n");
        sb.append("<table>\n<thead><tr>");
        sb.append("<th>分类</th><th>线程名</th><th>评估理由</th><th>栈深</th><th>栈顶帧</th></tr></thead>\n");
        sb.append("<tbody>\n");

        for (CpuThreadResult r : results) {
            String rowColor;
            String catLabel;
            String catBg;
            switch (r.category) {
                case CPU_CONSUMING:
                    catLabel = "CPU 消耗"; catBg = "#ff4d4f"; rowColor = "#fff2f0";
                    break;
                case IO_WAIT:
                    catLabel = "IO 等待"; catBg = "#8c8c8c"; rowColor = "#fafafa";
                    break;
                default:
                    catLabel = "GC 系统"; catBg = "#13c2c2"; rowColor = "#e6fffb";
                    break;
            }

            sb.append("<tr style=\"background:").append(rowColor).append(";");
            if (r.category != CpuCategory.CPU_CONSUMING) {
                sb.append("opacity:0.6;");
            }
            sb.append("\">\n");
            sb.append("<td><span class=\"tag\" style=\"background:").append(catBg).append(";color:#fff;\">").append(catLabel).append("</span></td>\n");
            sb.append("<td><code style=\"font-size:12px;\">").append(escapeHtml(r.thread.getName())).append("</code></td>\n");
            sb.append("<td style=\"font-size:12px;color:#666;\">");
            for (int i = 0; i < r.reasons.size(); i++) {
                if (i > 0) sb.append("<br>");
                sb.append("• ").append(escapeHtml(r.reasons.get(i)));
            }
            sb.append("</td>\n");
            sb.append("<td>").append(r.stackDepth).append("</td>\n");
            sb.append("<td style=\"font-family:monospace;font-size:11px;color:#1677ff;\">").append(escapeHtml(r.topFrame.substring(0, Math.min(100, r.topFrame.length())))).append("</td>\n");
            sb.append("</tr>\n");
        }

        sb.append("</tbody></table>\n");
        sb.append("</div>\n");
        sb.append("</div>\n");
        return sb.toString();
    }

    // ================================================================
    // 相同堆栈
    // ================================================================

    private String renderStackGroups(List<ReportService.StackGroupVO> groups, int totalThreads) {
        StringBuilder sb = new StringBuilder();
        sb.append("<div class=\"card\">\n<h2>相同堆栈分析</h2>\n");
        sb.append("<input class=\"search-box\" id=\"group-search\" placeholder=\"搜索栈帧...\" oninput=\"filterGroups()\">\n");

        sb.append("<div style=\"max-height:70vh;overflow:auto;\">\n");
        sb.append("<table>\n<thead><tr>");
        sb.append("<th>数量</th><th>占比</th><th>首帧</th><th>状态分布</th><th>示例线程</th></tr></thead>\n");
        sb.append("<tbody id=\"groups-tbody\">\n");

        for (ReportService.StackGroupVO g : groups) {
            double pct = totalThreads > 0 ? g.getCount() * 100.0 / totalThreads : 0;
            String countColor = g.getCount() > totalThreads * 0.3 ? "#ff4d4f" : g.getCount() > 10 ? "#fa8c16" : "#52c41a";

            sb.append("<tr>\n");
            sb.append("<td style=\"font-weight:700;color:").append(countColor).append(";\">").append(g.getCount()).append("</td>\n");
            sb.append("<td>\n<div class=\"group-bar\"><div class=\"group-bar-fill\" style=\"width:").append(String.format("%.1f", pct)).append("%\"></div></div>")
              .append(String.format("%.1f", pct)).append("%</td>\n");
            sb.append("<td style=\"font-family:monospace;font-size:12px;color:#1677ff;\">").append(escapeHtml(g.getFirstFrame())).append("</td>\n");
            sb.append("<td>");
            for (Map.Entry<String, Long> e : g.getStates().entrySet()) {
                String sc = STATE_COLORS.getOrDefault(e.getKey(), "#8c8c8c");
                sb.append("<span class=\"tag\" style=\"background:").append(sc).append(";color:#fff;margin-right:4px;\">").append(e.getKey()).append(" ").append(e.getValue()).append("</span>");
            }
            sb.append("</td>\n");
            sb.append("<td style=\"font-family:monospace;font-size:11px;color:#666;\">").append(escapeHtml(g.getAllThreadNames().stream().limit(3).collect(Collectors.joining(", ")))).append("</td>\n");
            sb.append("</tr>\n");
        }

        sb.append("</tbody></table>\n");
        sb.append("</div>\n");
        sb.append("</div>\n");
        return sb.toString();
    }

    // ================================================================
    // 辅助方法
    // ================================================================

    private String statCard(String label, String value, String type) {
        return String.format("<div class=\"stat %s\"><div class=\"num\">%s</div><div class=\"label\">%s</div></div>\n",
                type, value, label);
    }

    private String escapeHtml(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
