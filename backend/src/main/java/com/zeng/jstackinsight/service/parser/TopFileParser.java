package com.zeng.jstackinsight.service.parser;

import com.zeng.jstackinsight.service.parser.model.ThreadInfo;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * top -H 输出文件解析器
 *
 * <p>解析 Linux top -H（线程视图）的输出，提取每个线程的 PID 和 CPU 占用率。
 * 关键匹配逻辑：
 * <ul>
 *   <li>top -H 显示的是系统原生线程 PID（十进制）</li>
 *   <li>jstack 显示的是 nid=0xXXXX（十六进制）</li>
 *   <li>两者是同一值的不同进制表示，需要转换后关联</li>
 * </ul>
 *
 * <p>支持 top 输出格式：
 * <pre>
 *   PID USER      PR  NI    VIRT    RES    SHR S %CPU %MEM     TIME+ COMMAND
 *   1234 root      20   0 1234567 123456  12345 S 45.2  3.1   1:23.45 java
 * </pre>
 *
 * @author zeng
 */
@Component
public class TopFileParser {

    /**
     * top 进程行的正则
     * <p>top -H 每行格式：PID USER PR NI VIRT RES SHR S %CPU %MEM TIME+ COMMAND
     * 其中 %CPU 可能为浮点数
     */
    private static final Pattern TOP_LINE_PATTERN = Pattern.compile(
            "^\\s*(\\d+)\\s+\\S+\\s+\\d+\\s+-?\\d+\\s+[\\d.]+[kmgt]?\\s+[\\d.]+[kmgt]?\\s+[\\d.]+[kmgt]?\\s+[SRZTDWI]\\s+([\\d.]+)",
            Pattern.MULTILINE
    );

    /**
     * 解析 top -H 输出文本
     *
     * @param content top 命令的完整输出文本
     * @return 线程 ID(十进制) -> CPU% 的映射
     */
    public Map<Integer, Double> parse(String content) {
        Map<Integer, Double> result = new LinkedHashMap<>();
        String[] lines = content.split("\\r?\\n");
        boolean headerSkipped = false;

        for (String line : lines) {
            // 跳过空行
            if (line.trim().isEmpty()) continue;

            // 跳过顶部摘要行（如 "top - ..." 或 "Tasks: ..." 或 "%Cpu(s): ..."）
            if (line.startsWith("top ") || line.startsWith("Tasks")
                    || line.startsWith("%Cpu") || line.startsWith("MiB")
                    || line.startsWith("KiB") || line.startsWith("Mem")
                    || line.startsWith("Swap")) {
                continue;
            }

            // 跳过表头行
            if (line.contains("PID") && line.contains("%CPU")) {
                headerSkipped = true;
                continue;
            }

            // 解析数据行
            Matcher m = TOP_LINE_PATTERN.matcher(line);
            if (m.find()) {
                try {
                    int pid = Integer.parseInt(m.group(1));
                    double cpu = Double.parseDouble(m.group(2));
                    result.put(pid, cpu);
                } catch (NumberFormatException ignored) {
                    // 跳过无法解析的行
                }
            }
        }

        return result;
    }

    /**
     * 将 top 解析结果与 jstack 线程关联
     *
     * <p>核心关联逻辑：
     * <ul>
     *   <li>top 的 PID（十进制）与 jstack 的 nid（十六进制）是同一系统线程 ID</li>
     *   <li>将 top PID 转为十六进制后去掉 "0x" 前缀，与 jstack 的 nid 进行匹配</li>
     * </ul>
     *
     * @param topCpuMap   top 解析结果：PID(十进制) -> CPU%
     * @param jstackThreads jstack 解析出的线程列表
     * @return 匹配到的线程 CPU% 映射：nid(十六进制) -> CPU%
     */
    public Map<String, Double> correlate(
            Map<Integer, Double> topCpuMap,
            List<ThreadInfo> jstackThreads) {

        // 构建 nid -> ThreadInfo 映射
        Map<String, ThreadInfo> nidMap = new LinkedHashMap<>();
        for (ThreadInfo t : jstackThreads) {
            if (t.getNid() != null && !t.getNid().isEmpty()) {
                nidMap.put(normalizeNid(t.getNid()), t);
            }
        }

        Map<String, Double> cpuByNid = new LinkedHashMap<>();
        for (Map.Entry<Integer, Double> entry : topCpuMap.entrySet()) {
            int decimalPid = entry.getKey();
            String hexNid = normalizeNid(Integer.toHexString(decimalPid));
            ThreadInfo matched = nidMap.get(hexNid);
            if (matched != null) {
                // key 统一为小写无 0x 前缀格式，与 AnalysisController 查询时使用的格式一致
                cpuByNid.put(normalizeNid(matched.getNid()), entry.getValue());
            }
        }

        return cpuByNid;
    }

    /**
     * 轻量关联：仅基于 nid 字符串匹配，不依赖 ThreadInfo。
     * <p>适合从报告摘要中获取 nid 列表的场景（不需要关联原始解析对象）。
     *
     * @param topCpuMap top 解析结果：PID(十进制) -> CPU%
     * @param nidSet    jstack 中所有线程的 nid 集合（已规范化，小写无 0x 前缀）
     * @return 匹配到的线程 CPU% 映射：nid(小写无 0x 前缀) -> CPU%
     */
    public Map<String, Double> correlateByNid(
            Map<Integer, Double> topCpuMap,
            java.util.Set<String> nidSet) {

        Map<String, Double> cpuByNid = new LinkedHashMap<>();
        for (Map.Entry<Integer, Double> entry : topCpuMap.entrySet()) {
            String hexNid = normalizeNid(Integer.toHexString(entry.getKey()));
            if (nidSet.contains(hexNid)) {
                cpuByNid.put(hexNid, entry.getValue());
            }
        }
        return cpuByNid;
    }
    private String normalizeNid(String nid) {
        String n = nid.toLowerCase();
        if (n.startsWith("0x")) {
            n = n.substring(2);
        }
        // 去除前导零后保持一致比较
        return n;
    }
}
