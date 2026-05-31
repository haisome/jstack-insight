package com.zeng.jstackinsight.converter;

import com.zeng.jstackinsight.api.response.*;
import com.zeng.jstackinsight.service.analyzer.DeadlockDetector;
import com.zeng.jstackinsight.service.analyzer.HotspotAnalyzer;
import com.zeng.jstackinsight.service.parser.model.JStackDump;
import com.zeng.jstackinsight.service.parser.model.ThreadInfo;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 领域模型 → VO 转换器
 *
 * <p>将解析器输出的领域模型（{@link JStackDump}）和分析器结果，
 * 转换为前端所需的各类 VO，组装成 {@link AnalysisResultVO}。
 *
 * <p>职责边界：转换器只做字段映射和数据整形，不含业务逻辑。
 *
 * @author zeng
 */
@Component
public class AnalysisResultConverter {

    private final HotspotAnalyzer hotspotAnalyzer;

    public AnalysisResultConverter(HotspotAnalyzer hotspotAnalyzer) {
        this.hotspotAnalyzer = hotspotAnalyzer;
    }

    /**
     * 组装完整的分析结果 VO。
     *
     * @param dump             解析结果
     * @param detectionResult  死锁检测结果
     * @return 完整的 AnalysisResultVO
     */
    public AnalysisResultVO convert(JStackDump dump, DeadlockDetector.DetectionResult detectionResult) {
        List<ThreadInfo> threads = dump.getThreads();

        return AnalysisResultVO.builder()
                .threadState(buildThreadStateVO(threads, detectionResult))
                .lockGraph(buildLockGraphVO(threads, detectionResult))
                .flameGraph(hotspotAnalyzer.buildFlameGraph(threads))
                .deadlockChain(buildDeadlockChainVO(detectionResult))
                .build();
    }

    // ================================================================
    // 私有：线程状态 VO
    // ================================================================

    private ThreadStateVO buildThreadStateVO(List<ThreadInfo> threads,
                                              DeadlockDetector.DetectionResult result) {
        // 统计各状态数量
        Map<String, Integer> stateCounts = new LinkedHashMap<>();
        for (ThreadInfo t : threads) {
            String s = t.getState() != null ? t.getState() : "UNKNOWN";
            stateCounts.merge(s, 1, Integer::sum);
        }

        // 统计死锁线程数
        int deadlockCount = result.getDeadlockThreads().size();

        // 构建线程摘要列表
        List<ThreadStateVO.ThreadSummary> summaries = threads.stream()
                .map(t -> ThreadStateVO.ThreadSummary.builder()
                        .name(t.getName())
                        .nid(t.getNid())
                        .state(t.getState())
                        .inDeadlock(result.getDeadlockThreads().contains(t.getName()))
                        .waitingOnLock(t.getWaitingOnLock())
                        .waitingOnLockClass(t.getWaitingOnLockClass())
                        .lockedMonitors(t.getLockedMonitors())
                        .lockedMonitorClasses(t.getLockedMonitorClasses())
                        .stackTrace(t.getStackFrames())
                        .build())
                .collect(Collectors.toList());

        return ThreadStateVO.builder()
                .totalThreads(threads.size())
                .stateCounts(stateCounts)
                .deadlockCount(deadlockCount)
                .threads(summaries)
                .build();
    }

    // ================================================================
    // 私有：锁图 VO
    // ================================================================

    private LockGraphVO buildLockGraphVO(List<ThreadInfo> threads,
                                          DeadlockDetector.DetectionResult result) {
        List<LockGraphVO.GraphNode> nodes = new ArrayList<>();
        List<LockGraphVO.GraphEdge> edges = new ArrayList<>();
        Set<String> addedLocks = new HashSet<>();
        Set<String> deadlockThreads = result.getDeadlockThreads();

        for (ThreadInfo t : threads) {
            boolean hasLockRelation = !t.getLockedMonitors().isEmpty()
                    || t.getWaitingOnLock() != null;
            if (!hasLockRelation) {
                continue; // 没有锁关系的线程不加入图
            }

            boolean inDeadlock = deadlockThreads.contains(t.getName());

            // 添加线程节点
            nodes.add(LockGraphVO.GraphNode.builder()
                    .id("thread:" + t.getName())
                    .label(t.getName())
                    .type("THREAD")
                    .state(t.getState())
                    .inDeadlock(inDeadlock)
                    .build());

            // 持有锁 → 添加锁节点 + HOLDS 边
            for (String lockAddr : t.getLockedMonitors()) {
                if (addedLocks.add(lockAddr)) {
                    nodes.add(LockGraphVO.GraphNode.builder()
                            .id("lock:" + lockAddr)
                            .label(lockAddr)
                            .type("LOCK")
                            .inDeadlock(inDeadlock)
                            .build());
                }
                edges.add(LockGraphVO.GraphEdge.builder()
                        .source("thread:" + t.getName())
                        .target("lock:" + lockAddr)
                        .relation("HOLDS")
                        .inDeadlock(inDeadlock)
                        .build());
            }

            // 等待锁 → 添加锁节点（若不存在）+ WAITING 边
            if (t.getWaitingOnLock() != null) {
                String lockAddr = t.getWaitingOnLock();
                if (addedLocks.add(lockAddr)) {
                    nodes.add(LockGraphVO.GraphNode.builder()
                            .id("lock:" + lockAddr)
                            .label(lockAddr)
                            .type("LOCK")
                            .inDeadlock(inDeadlock)
                            .build());
                }
                edges.add(LockGraphVO.GraphEdge.builder()
                        .source("thread:" + t.getName())
                        .target("lock:" + lockAddr)
                        .relation("WAITING")
                        .inDeadlock(inDeadlock)
                        .build());
            }
        }

        // 死锁链路描述
        List<String> chains = result.getChains().stream()
                .map(c -> String.join(" → ", c))
                .collect(Collectors.toList());

        return LockGraphVO.builder()
                .nodes(nodes)
                .edges(edges)
                .hasDeadlock(result.isDetected())
                .deadlockChains(chains)
                .build();
    }

    // ================================================================
    // 私有：死锁链路 VO
    // ================================================================

    private DeadlockChainVO buildDeadlockChainVO(DeadlockDetector.DetectionResult result) {
        List<String> descriptions = result.getChains().stream()
                .map(chain -> "死锁环路: " + String.join(" → ", chain))
                .collect(Collectors.toList());

        return DeadlockChainVO.builder()
                .detected(result.isDetected())
                .chains(result.getChains())
                .descriptions(descriptions)
                .build();
    }
}
