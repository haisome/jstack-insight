package com.zeng.jstackinsight.service.impl;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zeng.jstackinsight.api.response.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.annotation.PostConstruct;
import java.io.File;
import java.io.IOException;
import java.nio.file.NoSuchFileException;
import java.util.*;
import java.util.concurrent.TimeUnit;

/**
 * 报告持久化服务。
 *
 * <p>分析完成后将 {@link AnalysisResultVO} 按模块拆分为独立 JSON 文件，
 * 每个 API 只读取自己需要的那份，避免每次加载整个 2-3MB 的 result.json。
 *
 * <p>存储结构（线程详情按 50 条/桶分批，避免单文件过大或文件数暴增）：
 * <pre>
 *   jstackInsightData/reports/
 *     {yyyyMMdd}/              — 日期目录，方便文件管理
 *       {rawUuid}/             — 原始 UUID 目录（不含日期前缀）
 *         meta.json              — 元数据 (~200B)
 *         threads-summary.json   — 线程摘要，不含调用栈 (~200KB)
 *         threads-idx.json       — tid → 分桶索引 (~10KB)
 *         threads-0.json         — 完整线程详情分桶 (~100KB/桶)
 *         lock-graph.json        — 锁竞争图 (~50KB)
 *         flame-graph.json       — 火焰图 (~200KB)
 *         deadlocks.json         — 死锁链路 (~5KB)
 * </pre>
 *
 * @author zeng
 */
@Service
public class ReportService {

    private static final Logger log = LoggerFactory.getLogger(ReportService.class);

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final com.fasterxml.jackson.databind.ObjectWriter prettyWriter = objectMapper.writerWithDefaultPrettyPrinter();

    @Value("${jstack-insight.report.dir:data/reports}")
    private String reportDir;

    @Value("${jstack-insight.report.expire-hours:24}")
    private int expireHours;

    @Value("${jstack-insight.report.extend-hours:48}")
    private int extendHours;

    @PostConstruct
    public void init() {
        File dir = new File(reportDir).getAbsoluteFile();
        this.reportDir = dir.getAbsolutePath();
        if (!dir.exists()) {
            dir.mkdirs();
        }
        log.info("报告存储目录: {} (默认{}h, 分享延长至{}h)", dir.getAbsolutePath(), expireHours, extendHours);

        int cleaned = cleanExpiredReports();
        if (cleaned > 0) {
            log.info("启动时清理了 {} 个过期报告", cleaned);
        }
        scheduleCleanup();
    }

    // ================================================================
    // 保存报告
    // ================================================================

    /**
     * 保存分析结果并返回报告 UUID。
     *
     * @param result   分析结果
     * @param filename 原始文件名
     * @return 报告 UUID
     */
    public String saveReport(AnalysisResultVO result, String filename) throws IOException {
        String rawUuid = UUID.randomUUID().toString().replace("-", "");
        String dateStr = java.time.LocalDate.now().toString().replace("-", ""); // yyyyMMdd
        String uuid = dateStr + rawUuid;
        File dir = new File(reportDir, dateStr + File.separator + rawUuid);
        dir.mkdirs();

        // 1. 元数据
        long now = System.currentTimeMillis();
        ReportMeta meta = ReportMeta.builder()
                .uuid(uuid).filename(filename)
                .expiresAt(now + TimeUnit.HOURS.toMillis(expireHours))
                .totalThreads(result.getThreadState() != null ? result.getThreadState().getTotalThreads() : 0)
                .hasDeadlock(result.getDeadlockChain() != null && result.getDeadlockChain().isDetected())
                .build();
        writeJson(new File(dir, "meta.json"), meta);

        // 2. 线程摘要 + 分批存储完整详情
        ThreadStateVO fullThreadState = result.getThreadState();
        if (fullThreadState != null && fullThreadState.getThreads() != null) {
            final int BATCH_SIZE = 50;
            List<ThreadStateVO.ThreadSummary> all = fullThreadState.getThreads();
            List<ThreadStateVO.ThreadSummary> summaries = new ArrayList<>();
            Map<Long, Integer> tidToBucket = new LinkedHashMap<>();

            for (int i = 0; i < all.size(); i++) {
                ThreadStateVO.ThreadSummary t = all.get(i);
                summaries.add(ThreadStateVO.ThreadSummary.builder()
                        .name(t.getName()).tid(t.getTid()).nid(t.getNid())
                        .state(t.getState())
                        .inDeadlock(t.isInDeadlock())
                        .finalizerTrapped(t.isFinalizerTrapped())
                        .throwingException(t.isThrowingException())
                        .waitingOnLockClass(t.getWaitingOnLockClass())
                        .waitingType(t.getWaitingType())
                        .cpuPercent(t.getCpuPercent())
                        .build());

                int bucket = i / BATCH_SIZE;
                tidToBucket.put(t.getTid(), bucket);
            }

            writeJson(new File(dir, "threads-summary.json"),
                    ThreadStateVO.builder()
                        .totalThreads(fullThreadState.getTotalThreads())
                        .stateCounts(fullThreadState.getStateCounts())
                        .deadlockCount(fullThreadState.getDeadlockCount())
                        .threads(summaries)
                        .build());

            // 索引：tid → 分桶编号
            writeJson(new File(dir, "threads-idx.json"), tidToBucket);

            // 分批写入完整详情到 threads/ 目录
            int buckets = ((all.size() - 1) / BATCH_SIZE) + 1;
            File threadsDir = new File(dir, "threads");
            threadsDir.mkdirs();
            for (int b = 0; b < buckets; b++) {
                int from = b * BATCH_SIZE;
                int to = Math.min(from + BATCH_SIZE, all.size());
                writeJson(new File(threadsDir, b + ".json"),
                        all.subList(from, to));
            }
        }

        // 3. 锁图
        if (result.getLockGraph() != null) {
            writeJson(new File(dir, "lock-graph.json"), result.getLockGraph());
        }

        // 4. 火焰图
        if (result.getFlameGraph() != null) {
            writeJson(new File(dir, "flame-graph.json"), result.getFlameGraph());
        }

        // 5. 死锁
        if (result.getDeadlockChain() != null) {
            writeJson(new File(dir, "deadlocks.json"), result.getDeadlockChain());
        }

        log.info("报告已保存: uuid={}, 文件={}, 线程数={}", uuid, filename, meta.getTotalThreads());
        return uuid;
    }

    private void writeJson(File file, Object obj) throws IOException {
        prettyWriter.writeValue(file, obj);
    }

    // ================================================================
    // 按需加载（各自读独立小文件）
    // ================================================================

    public ReportSummaryVO getSummary(String uuid) throws IOException {
        ReportMeta meta = loadMeta(uuid);
        return ReportSummaryVO.builder()
                .uuid(uuid).filename(meta.getFilename())
                .expiresAt(meta.getExpiresAt())
                .totalThreads(meta.getTotalThreads())
                .hasDeadlock(meta.isHasDeadlock())
                .build();
    }

    public DeadlockChainVO getDeadlocks(String uuid) throws IOException {
        File file = findReportFile(uuid, "deadlocks.json");
        if (file == null) return DeadlockChainVO.builder().detected(false).build();
        return objectMapper.readValue(file, DeadlockChainVO.class);
    }

    public LockGraphVO getLockGraph(String uuid) throws IOException {
        File file = findReportFile(uuid, "lock-graph.json");
        if (file == null) throw new NoSuchFileException("报告不存在: " + uuid);
        return objectMapper.readValue(file, LockGraphVO.class);
    }

    public FlameGraphVO getFlameGraph(String uuid) throws IOException {
        File file = findReportFile(uuid, "flame-graph.json");
        if (file == null) throw new NoSuchFileException("报告不存在: " + uuid);
        return objectMapper.readValue(file, FlameGraphVO.class);
    }

    public ThreadStateVO getThreadStateSummary(String uuid) throws IOException {
        File file = findReportFile(uuid, "threads-summary.json");
        if (file == null) throw new NoSuchFileException("报告不存在: " + uuid);
        return objectMapper.readValue(file, ThreadStateVO.class);
    }

    public ThreadStateVO getThreadsPaged(String uuid, int page, int size) throws IOException {
        ThreadStateVO full = getThreadStateSummary(uuid);
        if (full == null || full.getThreads() == null) return emptyThreadState();

        List<ThreadStateVO.ThreadSummary> all = full.getThreads();
        int from = page * size;
        int to = Math.min(from + size, all.size());
        List<ThreadStateVO.ThreadSummary> paged = from >= all.size()
                ? Collections.emptyList() : all.subList(from, to);

        return ThreadStateVO.builder()
                .totalThreads(all.size())
                .stateCounts(full.getStateCounts())
                .deadlockCount(full.getDeadlockCount())
                .threads(paged).build();
    }

    /**
     * 加载线程分桶索引。
     */
    public Map<String, Integer> getThreadIndex(String uuid) throws IOException {
        File idxFile = findReportFile(uuid, "threads-idx.json");
        if (idxFile == null) throw new NoSuchFileException("报告不存在: " + uuid);
        @SuppressWarnings("unchecked")
        Map<String, Integer> idx = objectMapper.readValue(idxFile, Map.class);
        return idx;
    }

    /**
     * 获取单个分桶的所有完整线程详情（供前端缓存）。
     */
    public List<ThreadStateVO.ThreadSummary> getThreadBucket(String uuid, int bucket) throws IOException {
        File file = findReportFile(uuid, "threads" + File.separator + bucket + ".json");
        if (file == null) throw new NoSuchFileException("分桶不存在: " + bucket);
        return Arrays.asList(objectMapper.readValue(file, ThreadStateVO.ThreadSummary[].class));
    }

    /**
     * 相同堆栈分组（预计算，避免前端拉取全量线程后再分组）。
     * 返回量 ~50KB vs 全量 ~2MB。
     */
    public List<StackGroupVO> getStackGroups(String uuid) throws IOException {
        List<ThreadStateVO.ThreadSummary> all = getAllThreadDetails(uuid);
        Map<String, List<ThreadStateVO.ThreadSummary>> groups = new LinkedHashMap<>();

        for (ThreadStateVO.ThreadSummary t : all) {
            String key = t.getStackTrace() != null
                    ? String.join("\0", t.getStackTrace()) : "(no stack)";
            groups.computeIfAbsent(key, k -> new ArrayList<>()).add(t);
        }

        List<StackGroupVO> result = new ArrayList<>();
        for (Map.Entry<String, List<ThreadStateVO.ThreadSummary>> entry : groups.entrySet()) {
            List<ThreadStateVO.ThreadSummary> members = entry.getValue();
            ThreadStateVO.ThreadSummary sample = members.get(0);
            Map<String, Long> states = new LinkedHashMap<>();
            for (ThreadStateVO.ThreadSummary t : members) {
                if (t.getState() != null) {
                    states.merge(t.getState(), 1L, Long::sum);
                }
            }
            result.add(StackGroupVO.builder()
                    .stackKey(entry.getKey())
                    .count(members.size())
                    .firstFrame(sample.getStackTrace() != null && !sample.getStackTrace().isEmpty()
                            ? sample.getStackTrace().get(0) : "")
                    .secondFrame(sample.getStackTrace() != null && sample.getStackTrace().size() > 1
                            ? sample.getStackTrace().get(1) : "")
                    .states(states)
                    .sampleThread(sample)
                    .allThreadNames(members.stream()
                            .map(ThreadStateVO.ThreadSummary::getName)
                            .collect(java.util.stream.Collectors.toList()))
                    .build());
        }
        result.sort((a, b) -> Integer.compare(b.getCount(), a.getCount()));
        return result;
    }
    public List<ThreadStateVO.ThreadSummary> getAllThreadDetails(String uuid) throws IOException {
        List<ThreadStateVO.ThreadSummary> all = new ArrayList<>();
        for (int b = 0; ; b++) {
            File file = findReportFile(uuid, "threads" + File.separator + b + ".json");
            if (file == null) break;
            Collections.addAll(all,
                    objectMapper.readValue(file, ThreadStateVO.ThreadSummary[].class));
        }
        return all;
    }

    private ThreadStateVO emptyThreadState() {
        return ThreadStateVO.builder().totalThreads(0).stateCounts(Collections.emptyMap())
                .deadlockCount(0).threads(Collections.emptyList()).build();
    }

    private ReportMeta loadMeta(String uuid) throws IOException {
        File file = findReportFile(uuid, "meta.json");
        if (file == null) throw new NoSuchFileException("报告不存在或已过期: " + uuid);
        return objectMapper.readValue(file, ReportMeta.class);
    }

    /**
     * 延长报告有效期。仅当距离过期不足 extendHours 小时且距上次续期超过 2 小时时才延长。
     *
     * @return 延长后的过期时间戳
     */
    public long extend(String uuid) throws IOException {
        File file = findReportFile(uuid, "meta.json");
        if (file == null) throw new NoSuchFileException("报告不存在或已过期: " + uuid);
        ReportMeta meta = objectMapper.readValue(file, ReportMeta.class);

        long now = System.currentTimeMillis();
        long desiredExpiry = now + TimeUnit.HOURS.toMillis(extendHours);

        // 仅在过期时间不足且距上次续期超过 2 小时时才执行续期
        if (meta.getExpiresAt() < desiredExpiry
                && meta.getExpiresAt() < now + TimeUnit.HOURS.toMillis(extendHours - 2)) {
            meta.setExpiresAt(desiredExpiry);
            prettyWriter.writeValue(file, meta);
            log.info("报告有效期已延长至{}h后: uuid={}", extendHours, uuid);
        }
        return meta.getExpiresAt();
    }

    // ================================================================
    // 清理过期报告（递归删除含 threads 子目录）
    // ================================================================

    private void scheduleCleanup() {
        Thread cleanupThread = new Thread(() -> {
            while (!Thread.currentThread().isInterrupted()) {
                try {
                    TimeUnit.MINUTES.sleep(30);
                    int cleaned = cleanExpiredReports();
                    if (cleaned > 0) {
                        log.info("定时清理了 {} 个过期报告", cleaned);
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                } catch (Exception e) {
                    log.warn("清理过期报告失败", e);
                }
            }
        }, "report-cleanup");
        cleanupThread.setDaemon(true);
        cleanupThread.start();
    }

    private int cleanExpiredReports() {
        int count = 0;
        File root = new File(reportDir);
        File[] dateDirs = root.listFiles(File::isDirectory);
        if (dateDirs == null) return 0;

        long now = System.currentTimeMillis();

        for (File dateDir : dateDirs) {
            File[] reportDirs = dateDir.listFiles(File::isDirectory);
            if (reportDirs == null) continue;

            for (File reportDirFile : reportDirs) {
                File metaFile = new File(reportDirFile, "meta.json");
                if (!metaFile.exists()) continue;

                try {
                    ReportMeta meta = objectMapper.readValue(metaFile, ReportMeta.class);
                    if (meta.getExpiresAt() < now) {
                        deleteDirectory(reportDirFile);
                        count++;
                    }
                } catch (IOException e) {
                    // 读取失败则跳过
                }
            }

            File[] remaining = dateDir.listFiles(File::isDirectory);
            if (remaining == null || remaining.length == 0) {
                dateDir.delete();
            }
        }
        return count;
    }

    private void deleteDirectory(File dir) {
        File[] files = dir.listFiles();
        if (files != null) {
            for (File f : files) {
                if (f.isDirectory()) {
                    deleteDirectory(f);
                } else {
                    f.delete();
                }
            }
        }
        dir.delete();
    }

    // ================================================================
    // 辅助
    // ================================================================

    private File findReportFile(String uuid, String filename) {
        // UUID 前 8 位为日期前缀 (yyyyMMdd)，直接定位到对应日期目录；后 32 位为原始 UUID 目录名
        if (uuid == null || uuid.length() < 8) {
            log.warn("无效的 UUID 格式: {}", uuid);
            return null;
        }
        String datePrefix = uuid.substring(0, 8);
        String dirName = uuid.substring(8); // 原始 UUID（去掉日期前缀）
        File target = new File(reportDir, datePrefix + File.separator + dirName + File.separator + filename);
        return target.exists() ? target : null;
    }

    // ================================================================
    // 内部数据类
    // ================================================================

    @lombok.Data
    @lombok.Builder
    @lombok.NoArgsConstructor
    @lombok.AllArgsConstructor
    public static class ReportMeta {
        private String uuid;
        private String filename;
        private long expiresAt;
        private int totalThreads;
        private boolean hasDeadlock;
    }

    @lombok.Data
    @lombok.Builder
    @lombok.NoArgsConstructor
    @lombok.AllArgsConstructor
    public static class ReportSummaryVO {
        private String uuid;
        private String filename;
        private long expiresAt;
        private int totalThreads;
        private boolean hasDeadlock;
    }

    @lombok.Data
    @lombok.Builder
    @lombok.NoArgsConstructor
    @lombok.AllArgsConstructor
    public static class StackGroupVO {
        private String stackKey;
        private int count;
        private String firstFrame;
        private String secondFrame;
        private Map<String, Long> states;
        private ThreadStateVO.ThreadSummary sampleThread;
        private List<String> allThreadNames;
    }
}
