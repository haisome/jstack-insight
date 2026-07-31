package com.zeng.jstackinsight.controller;

import com.zeng.jstackinsight.api.response.AnalysisResultVO;
import com.zeng.jstackinsight.api.response.Result;
import com.zeng.jstackinsight.api.response.ThreadStateVO;
import com.zeng.jstackinsight.api.response.TopCpuVO;
import com.zeng.jstackinsight.service.impl.AnalysisServiceImpl;
import com.zeng.jstackinsight.service.impl.ReportService;
import com.zeng.jstackinsight.service.parser.TopFileParser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * jstack 分析接口
 *
 * <p>提供上传并解析 jstack 文件的 REST API。
 * Swagger UI：http://localhost:9595/swagger-ui.html
 *
 * @author zeng
 */
@Tag(name = "JStack 分析", description = "上传并分析 jstack 线程转储文件")
@RestController
@RequestMapping("/api/v1/analysis")
@CrossOrigin(origins = "*") // 开发阶段允许跨域，生产环境请配置具体 Origin
public class AnalysisController {

    private final AnalysisServiceImpl analysisService;
    private final TopFileParser topFileParser;
    private final ReportService reportService;

    public AnalysisController(AnalysisServiceImpl analysisService,
                              TopFileParser topFileParser,
                              ReportService reportService) {
        this.analysisService = analysisService;
        this.topFileParser = topFileParser;
        this.reportService = reportService;
    }

    /**
     * 上传并分析 jstack 文件，返回报告 UUID 和摘要。
     *
     * <p>分析结果持久化到文件系统，前端通过 {@code /api/v1/report/{uuid}/*} 按需加载。
     *
     * @param file 上传的 jstack 文件（.txt，最大 10MB）
     * @return 报告 UUID 和摘要
     */
    @Operation(
            summary = "上传并分析 jstack 文件",
            description = "上传 jstack 文件（.txt），分析并持久化，返回报告 UUID"
    )
    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Result<ReportService.ReportSummaryVO> upload(
            @Parameter(description = "jstack 输出文件（.txt）", required = true)
            @RequestParam("file") MultipartFile file) {

        if (file == null || file.isEmpty()) {
            return Result.fail(400, "文件不能为空");
        }
        String filename = file.getOriginalFilename();
        if (filename == null) {
            return Result.fail(400, "文件名不能为空");
        }

        try {
            AnalysisResultVO result = analysisService.analyze(file);
            String uuid = reportService.saveReport(result, filename);
            return Result.ok(reportService.getSummary(uuid));
        } catch (IllegalArgumentException e) {
            return Result.fail(400, "文件解析失败：" + e.getMessage());
        } catch (Exception e) {
            return Result.fail(500, "服务器内部错误：" + e.getMessage());
        }
    }

    /**
     * 通过报告 UUID 上传 top 文件进行精准 CPU 关联。
     *
     * <p>不需要重新上传 jstack，直接从已存储的报告摘要中读取 nid 列表进行关联。
     * 匹配到的线程会加载其完整详情（含栈帧）。
     *
     * @param uuid    报告 UUID
     * @param topFile top -H -p pid -n 1 -b 输出文件
     */
    @Operation(summary = "基于报告 UUID 的 top 文件 CPU 关联",
            description = "上传 top -H 文件，与指定报告中已解析的线程 nid 关联，返回精准 CPU 占用率")
    @PostMapping(value = "/top-cpu-with-report/{uuid}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Result<TopCpuVO> topCpuWithReport(
            @Parameter(description = "报告 UUID") @PathVariable String uuid,
            @Parameter(description = "top -H -p pid 输出的文件", required = true)
            @RequestParam("topFile") MultipartFile topFile) {

        if (topFile == null || topFile.isEmpty()) {
            return Result.fail(400, "top 文件不能为空");
        }

        try {
            // 1. 从报告摘要获取所有线程的 nid
            ThreadStateVO threadSummary = reportService.getThreadStateSummary(uuid);
            List<ThreadStateVO.ThreadSummary> threads = threadSummary.getThreads();

            // 构建 nid 集合用于关联
            Set<String> nidSet = new HashSet<>();
            Map<String, ThreadStateVO.ThreadSummary> nidToThread = new LinkedHashMap<>();
            for (ThreadStateVO.ThreadSummary ts : threads) {
                if (ts.getNid() != null && !ts.getNid().isEmpty()) {
                    String norm = ts.getNid().toLowerCase().replace("0x", "");
                    nidSet.add(norm);
                    nidToThread.put(norm, ts);
                }
            }

            // 2. 解析 top
            String topContent = new String(topFile.getBytes(), StandardCharsets.UTF_8);
            Map<Integer, Double> topCpuMap = topFileParser.parse(topContent);
            if (topCpuMap.isEmpty()) {
                return Result.fail(400, "top 文件解析失败：未找到有效的线程数据行");
            }

            // 3. 关联
            Map<String, Double> cpuByNid = topFileParser.correlateByNid(topCpuMap, nidSet);

            // 4. 加载完整线程详情以获取栈帧
            Map<Long, ThreadStateVO.ThreadSummary> tidMap = new LinkedHashMap<>();
            for (ThreadStateVO.ThreadSummary detail : reportService.getAllThreadDetails(uuid)) {
                tidMap.put(detail.getTid(), detail);
            }

            double totalCpu = 0;
            int matchedCount = 0;
            int unmatchedCount = topCpuMap.size() - cpuByNid.size();
            List<TopCpuVO.ThreadCpuInfo> threadCpuInfos = new ArrayList<>();

            for (Map.Entry<String, Double> entry : cpuByNid.entrySet()) {
                String nid = entry.getKey();
                Double cpu = entry.getValue();
                ThreadStateVO.ThreadSummary ts = nidToThread.get(nid);
                if (ts == null) continue;

                matchedCount++;
                totalCpu += cpu;

                String topFrame = "";
                ThreadStateVO.ThreadSummary detail = tidMap.get(ts.getTid());
                if (detail != null && detail.getStackTrace() != null && !detail.getStackTrace().isEmpty()) {
                    topFrame = detail.getStackTrace().get(0);
                }

                int pid = 0;
                try { pid = Integer.parseInt(nid, 16); } catch (NumberFormatException ignored) {}

                threadCpuInfos.add(TopCpuVO.ThreadCpuInfo.builder()
                        .name(ts.getName()).pid(pid).nid(ts.getNid())
                        .cpuPercent(cpu).state(ts.getState())
                        .topFrame(topFrame).inDeadlock(ts.isInDeadlock())
                        .build());
            }

            threadCpuInfos.sort((a, b) -> Double.compare(b.getCpuPercent(), a.getCpuPercent()));
            totalCpu = Math.round(totalCpu * 10.0) / 10.0;

            return Result.ok(TopCpuVO.builder()
                    .totalThreads(topCpuMap.size())
                    .totalCpuPercent(totalCpu)
                    .matchedCount(matchedCount)
                    .unmatchedCount(unmatchedCount)
                    .threads(threadCpuInfos)
                    .build());

        } catch (Exception e) {
            return Result.fail(500, "服务器内部错误：" + e.getMessage());
        }
    }
    @Operation(summary = "健康检查")
    @GetMapping("/health")
    public Result<String> health() {
        return Result.ok("JStack Insight is running!");
    }
}
