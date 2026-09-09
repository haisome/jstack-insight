package com.zeng.jstackinsight.controller;

import com.zeng.jstackinsight.api.response.*;
import com.zeng.jstackinsight.service.analyzer.CpuInferenceAnalyzer;
import com.zeng.jstackinsight.service.impl.ExportService;
import com.zeng.jstackinsight.service.impl.ReportService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.util.*;

import java.util.List;
import java.util.Map;

/**
 * 报告查看接口。
 *
 * <p>分析完成后，报告数据通过以下接口按需加载。首屏只需调用 /summary（~200B），
 * 切换 tab 时按需请求对应的数据接口，告别一次性传输几 MB 数据的卡顿。
 *
 * @author zeng
 */
@Tag(name = "报告查看", description = "按需加载分析报告的各个模块")
@RestController
@RequestMapping("/api/v1/report")
@CrossOrigin(origins = "*")
public class ReportController {

    private static final Logger log = LoggerFactory.getLogger(ReportController.class);

    private final ReportService reportService;
    private final ExportService exportService;
    private final CpuInferenceAnalyzer cpuInferenceAnalyzer;

    public ReportController(ReportService reportService, ExportService exportService,
                            CpuInferenceAnalyzer cpuInferenceAnalyzer) {
        this.reportService = reportService;
        this.exportService = exportService;
        this.cpuInferenceAnalyzer = cpuInferenceAnalyzer;
    }

    /**
     * 获取报告摘要（首屏展示用，几十字节）。
     */
    @Operation(summary = "获取报告摘要", description = "返回报告元信息：文件名、创建时间、线程总数、是否有死锁")
    @GetMapping("/{uuid}/summary")
    public Result<ReportService.ReportSummaryVO> getSummary(
            @Parameter(description = "报告 UUID") @PathVariable String uuid) {
        try {
            return Result.ok(reportService.getSummary(uuid));
        } catch (Exception e) {
            log.error("报告查询失败: uuid={}, {}", uuid, e.toString());
            return Result.fail(404, "报告不存在或已过期: " + uuid);
        }
    }

    /**
     * 获取线程状态汇总（不含完整调用栈，适合列表展示）。
     */
    @Operation(summary = "获取线程状态汇总", description = "返回所有线程的摘要信息（不含完整调用栈，数据量小）")
    @GetMapping("/{uuid}/threads-summary")
    public Result<ThreadStateVO> getThreadStateSummary(
            @Parameter(description = "报告 UUID") @PathVariable String uuid) {
        try {
            return Result.ok(reportService.getThreadStateSummary(uuid));
        } catch (Exception e) {
            log.error("报告查询失败: uuid={}, {}", uuid, e.toString());
            return Result.fail(404, "报告不存在或已过期: " + uuid);
        }
    }

    @Operation(summary = "获取全部线程完整详情", description = "一次性返回所有线程的完整信息（含调用栈），用于堆栈分析等需要全量数据的场景")
    @GetMapping("/{uuid}/threads-full")
    public Result<List<ThreadStateVO.ThreadSummary>> getThreadsFull(
            @Parameter(description = "报告 UUID") @PathVariable String uuid) {
        try {
            return Result.ok(reportService.getAllThreadDetails(uuid));
        } catch (Exception e) {
            log.error("查询失败: uuid={}, {}", uuid, e.toString());
            return Result.fail(404, "报告不存在或已过期: " + uuid);
        }
    }

    /**
     * 相同堆栈分组（预计算，轻量返回）。
     */
    @Operation(summary = "相同堆栈分组", description = "按完整调用栈分组，返回 ~50KB 轻量数据")
    @GetMapping("/{uuid}/stack-groups")
    public Result<List<ReportService.StackGroupVO>> getStackGroups(
            @Parameter(description = "报告 UUID") @PathVariable String uuid) {
        try {
            return Result.ok(reportService.getStackGroups(uuid));
        } catch (Exception e) {
            log.error("查询失败: uuid={}, {}", uuid, e.toString());
            return Result.fail(404, "报告不存在或已过期: " + uuid);
        }
    }

    /**
     * 分页获取线程列表（不含完整调用栈）。
     */
    @Operation(summary = "分页获取线程列表", description = "分页返回线程摘要，默认每页 50 条，不含完整调用栈")
    @GetMapping("/{uuid}/threads")
    public Result<ThreadStateVO> getThreadsPaged(
            @Parameter(description = "报告 UUID") @PathVariable String uuid,
            @Parameter(description = "页码（从 0 开始）") @RequestParam(defaultValue = "0") int page,
            @Parameter(description = "每页数量") @RequestParam(defaultValue = "50") int size) {
        try {
            return Result.ok(reportService.getThreadsPaged(uuid, page, size));
        } catch (Exception e) {
            log.error("报告查询失败: uuid={}, {}", uuid, e.toString());
            return Result.fail(404, "报告不存在或已过期: " + uuid);
        }
    }

    /**
     * 获取线程分桶索引（tid → bucket 映射）。
     * 前端持有后可按需请求分桶并缓存。
     */
    @Operation(summary = "线程分桶索引", description = "返回 tid → bucket 映射，前端据此按需加载分桶")
    @GetMapping("/{uuid}/threads-idx")
    public Result<Map<String, Integer>> getThreadsIdx(
            @Parameter(description = "报告 UUID") @PathVariable String uuid) {
        try {
            return Result.ok(reportService.getThreadIndex(uuid));
        } catch (Exception e) {
            log.error("查询失败: uuid={}, {}", uuid, e.toString());
            return Result.fail(404, "报告不存在或已过期: " + uuid);
        }
    }

    /**
     * 获取一个线程分桶（含 ~50 条完整线程详情，供前端缓存）。
     */
    @Operation(summary = "线程分桶", description = "返回指定分桶中约 50 个线程的完整信息")
    @GetMapping("/{uuid}/thread-bucket/{bucket}")
    public Result<List<ThreadStateVO.ThreadSummary>> getThreadsBucket(
            @Parameter(description = "报告 UUID") @PathVariable String uuid,
            @Parameter(description = "分桶编号") @PathVariable int bucket) {
        try {
            return Result.ok(reportService.getThreadBucket(uuid, bucket));
        } catch (Exception e) {
            log.error("查询失败: uuid={}, {}", uuid, e.toString());
            return Result.fail(404, "报告不存在或已过期: " + uuid);
        }
    }

    /**
     * 获取锁竞争图数据。
     */
    @Operation(summary = "获取锁竞争图", description = "返回锁竞争图的节点和边数据")
    @GetMapping("/{uuid}/lock-graph")
    public Result<LockGraphVO> getLockGraph(
            @Parameter(description = "报告 UUID") @PathVariable String uuid) {
        try {
            return Result.ok(reportService.getLockGraph(uuid));
        } catch (Exception e) {
            log.error("报告查询失败: uuid={}, {}", uuid, e.toString());
            return Result.fail(404, "报告不存在或已过期: " + uuid);
        }
    }

    /**
     * 获取火焰图数据。
     */
    @Operation(summary = "获取火焰图", description = "返回火焰图的树状结构数据")
    @GetMapping("/{uuid}/flame-graph")
    public Result<FlameGraphVO> getFlameGraph(
            @Parameter(description = "报告 UUID") @PathVariable String uuid) {
        try {
            return Result.ok(reportService.getFlameGraph(uuid));
        } catch (Exception e) {
            log.error("报告查询失败: uuid={}, {}", uuid, e.toString());
            return Result.fail(404, "报告不存在或已过期: " + uuid);
        }
    }

    /**
     * 获取 CPU 线程推测结果（与导出的 HTML 报告完全同源）。
     *
     * <p>推测依赖完整调用栈，必须在后端基于完整线程详情计算；
     * 前端只有不含栈的线程摘要，自行推测会把所有 RUNNABLE 线程误判为 CPU 消耗。
     */
    @Operation(summary = "CPU 线程推测", description = "对 RUNNABLE 线程做启发式分类：CPU 消耗 / IO 等待 / GC 系统")
    @GetMapping("/{uuid}/cpu-inference")
    public Result<CpuInferenceVO> getCpuInference(
            @Parameter(description = "报告 UUID") @PathVariable String uuid) {
        try {
            List<ThreadStateVO.ThreadSummary> fullThreads = reportService.getAllThreadDetails(uuid);
            return Result.ok(cpuInferenceAnalyzer.analyze(fullThreads));
        } catch (Exception e) {
            log.error("CPU 推测失败: uuid={}, {}", uuid, e.toString());
            return Result.fail(404, "报告不存在或已过期: " + uuid);
        }
    }

    /**
     * 获取死锁链路详情。
     */
    @Operation(summary = "获取死锁链路", description = "返回死锁检测结果和链路详情")
    @GetMapping("/{uuid}/deadlocks")
    public Result<DeadlockChainVO> getDeadlocks(
            @Parameter(description = "报告 UUID") @PathVariable String uuid) {
        try {
            return Result.ok(reportService.getDeadlocks(uuid));
        } catch (Exception e) {
            log.error("报告查询失败: uuid={}, {}", uuid, e.toString());
            return Result.fail(404, "报告不存在或已过期: " + uuid);
        }
    }

    /**
     * 延长报告有效期至 5 天（重置创建时间戳）。
     */
    @Operation(summary = "延长报告有效期", description = "若过期时间不足 48h 则延长至 48h，用于分享场景")
    @PostMapping("/{uuid}/extend")
    public Result<Long> extend(
            @Parameter(description = "报告 UUID") @PathVariable String uuid) {
        try {
            long expiresAt = reportService.extend(uuid);
            return Result.ok(expiresAt);
        } catch (Exception e) {
            log.error("延长有效期失败: uuid={}, {}", uuid, e.toString());
            return Result.fail(404, "报告不存在或已过期: " + uuid);
        }
    }

    /**
     * 导出自包含的静态 HTML 报告文件。
     */
    @Operation(summary = "导出 HTML 报告", description = "生成自包含的静态 HTML 文件，可直接用浏览器打开")
    @GetMapping("/{uuid}/export-html")
    public ResponseEntity<byte[]> exportHtml(
            @Parameter(description = "报告 UUID") @PathVariable String uuid) {
        try {
            String html = exportService.exportHtml(uuid);
            byte[] bytes = html.getBytes(StandardCharsets.UTF_8);
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(new MediaType("text", "html", StandardCharsets.UTF_8));
            headers.setContentDispositionFormData("attachment", "jstack-report-" + uuid.substring(uuid.length() - 8) + ".html");
            return ResponseEntity.ok().headers(headers).body(bytes);
        } catch (Exception e) {
            log.error("导出 HTML 失败: uuid={}, {}", uuid, e.toString());
            throw new RuntimeException("导出失败: " + e.getMessage());
        }
    }
}
