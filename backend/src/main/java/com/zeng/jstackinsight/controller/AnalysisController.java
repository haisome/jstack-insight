package com.zeng.jstackinsight.controller;

import com.zeng.jstackinsight.api.response.AnalysisResultVO;
import com.zeng.jstackinsight.api.response.Result;
import com.zeng.jstackinsight.api.response.ThreadStateVO;
import com.zeng.jstackinsight.api.response.TopCpuVO;
import com.zeng.jstackinsight.service.impl.AnalysisServiceImpl;
import com.zeng.jstackinsight.service.parser.TopFileParser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

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

    public AnalysisController(AnalysisServiceImpl analysisService,
                              TopFileParser topFileParser) {
        this.analysisService = analysisService;
        this.topFileParser = topFileParser;
    }

    /**
     * 上传并分析 jstack 文件。
     *
     * <p>接受 multipart/form-data 形式上传的 .txt 文件，
     * 返回包含线程状态、锁图、火焰图、死锁链路的完整分析结果。
     *
     * @param file 上传的 jstack .txt 文件（最大 50MB）
     * @return 分析结果
     */
    @Operation(
            summary = "上传并分析 jstack 文件",
            description = "上传 jstack 输出的 .txt 文件，返回线程状态分布、锁竞争图、火焰图和死锁检测结果"
    )
    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Result<AnalysisResultVO> upload(
            @Parameter(description = "jstack 输出的 .txt 文件", required = true)
            @RequestParam("file") MultipartFile file) {

        // 基础校验
        if (file == null || file.isEmpty()) {
            return Result.fail(400, "文件不能为空");
        }
        String filename = file.getOriginalFilename();
        if (filename != null && !filename.endsWith(".txt")) {
            return Result.fail(400, "仅支持 .txt 格式的 jstack 文件");
        }

        try {
            AnalysisResultVO result = analysisService.analyze(file);
            return Result.ok(result);
        } catch (IllegalArgumentException e) {
            return Result.fail(400, "文件解析失败：" + e.getMessage());
        } catch (Exception e) {
            return Result.fail(500, "服务器内部错误：" + e.getMessage());
        }
    }

    /**
     * 上传 top -H 文件并与已有的 jstack 分析结果进行 CPU 关联。
     *
     * <p>需要同时上传 jstack 文件和 top -H 文件。
     * 核心关联逻辑：top -H 的 PID（十进制）= jstack 的 nid（十六进制）。
     * 例如：top 中 PID=12345，转换为十六进制 0x3039，在 jstack 中搜索 nid=0x3039。
     *
     * @param jstackFile jstack 输出文件
     * @param topFile    top -H -p pid -n 1 -b 输出文件
     * @return 精确 CPU 分析结果
     */
    @Operation(
            summary = "上传 top 文件关联 CPU 分析",
            description = "同时上传 jstack 和 top -H 文件，通过 PID(十进制) 与 nid(十六进制) 关联，返回精确的线程 CPU 占用率"
    )
    @PostMapping(value = "/top-cpu", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Result<TopCpuVO> topCpu(
            @Parameter(description = "jstack 输出的 .txt 文件", required = true)
            @RequestParam("jstackFile") MultipartFile jstackFile,
            @Parameter(description = "top -H -p pid 输出的 .txt 文件", required = true)
            @RequestParam("topFile") MultipartFile topFile) {

        if (jstackFile == null || jstackFile.isEmpty()) {
            return Result.fail(400, "jstack 文件不能为空");
        }
        if (topFile == null || topFile.isEmpty()) {
            return Result.fail(400, "top 文件不能为空");
        }

        try {
            // 1. 解析 jstack
            String jstackContent = new String(jstackFile.getBytes(), StandardCharsets.UTF_8);
            AnalysisResultVO analysisResult = analysisService.analyze(jstackContent);

            // 2. 解析 top
            String topContent = new String(topFile.getBytes(), StandardCharsets.UTF_8);
            Map<Integer, Double> topCpuMap = topFileParser.parse(topContent);

            if (topCpuMap.isEmpty()) {
                return Result.fail(400, "top 文件解析失败：未找到有效的线程数据行");
            }

            // 3. 重新解析 jstack 获取 ThreadInfo 列表（用于 nid 关联）
            List<com.zeng.jstackinsight.service.parser.model.ThreadInfo> jstackThreads =
                    analysisService.getParser().parse(jstackContent).getThreads();
            Map<String, Double> cpuByNid = topFileParser.correlate(topCpuMap, jstackThreads);

            // 4. 组装 TopCpuVO
            double totalCpu = 0;
            int matchedCount = 0;
            int unmatchedCount = topCpuMap.size() - cpuByNid.size();
            List<TopCpuVO.ThreadCpuInfo> threadCpuInfos = new ArrayList<>();

            for (ThreadStateVO.ThreadSummary threadSummary : analysisResult.getThreadState().getThreads()) {
                String nid = threadSummary.getNid();
                if (nid == null || nid.isEmpty()) continue;

                Double cpu = cpuByNid.get(nid.toLowerCase().replace("0x", ""));
                if (cpu != null) {
                    matchedCount++;
                    totalCpu += cpu;
                    threadCpuInfos.add(TopCpuVO.ThreadCpuInfo.builder()
                            .name(threadSummary.getName())
                            .tid(Integer.parseInt(nid.startsWith("0x") ? nid.substring(2) : nid, 16))
                            .nid(nid)
                            .cpuPercent(cpu)
                            .state(threadSummary.getState())
                            .topFrame(threadSummary.getStackTrace() != null && !threadSummary.getStackTrace().isEmpty()
                                    ? threadSummary.getStackTrace().get(0) : "")
                            .inDeadlock(threadSummary.isInDeadlock())
                            .build());
                }
            }

            // 按 CPU% 降序排序
            threadCpuInfos.sort((a, b) -> Double.compare(b.getCpuPercent(), a.getCpuPercent()));

            // 四舍五入
            totalCpu = Math.round(totalCpu * 10.0) / 10.0;

            TopCpuVO result = TopCpuVO.builder()
                    .totalThreads(topCpuMap.size())
                    .totalCpuPercent(totalCpu)
                    .matchedCount(matchedCount)
                    .unmatchedCount(unmatchedCount)
                    .threads(threadCpuInfos)
                    .build();

            return Result.ok(result);

        } catch (IllegalArgumentException e) {
            return Result.fail(400, "解析失败：" + e.getMessage());
        } catch (Exception e) {
            return Result.fail(500, "服务器内部错误：" + e.getMessage());
        }
    }

    /**
     * 健康检查接口
     */
    @Operation(summary = "健康检查")
    @GetMapping("/health")
    public Result<String> health() {
        return Result.ok("JStack Insight is running!");
    }
}
