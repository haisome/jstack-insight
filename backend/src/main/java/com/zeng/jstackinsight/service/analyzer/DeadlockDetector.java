package com.zeng.jstackinsight.service.analyzer;

import com.zeng.jstackinsight.service.parser.model.ThreadInfo;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.*;

/**
 * 死锁检测器
 *
 * <h2>算法：基于 DFS 的有向图环路检测</h2>
 *
 * <h3>死锁的本质</h3>
 * <p>JVM 死锁 = 线程-锁等待关系图中存在环路（Cycle）。
 * 例如：
 * <pre>
 *   Thread-A —[等待]→ Lock-X —[持有者]→ Thread-B —[等待]→ Lock-Y —[持有者]→ Thread-A
 * </pre>
 * 上述形成一个环：A → B → A，即 Thread-A 和 Thread-B 互相死锁。
 *
 * <h3>图的构建</h3>
 * <p>我们将线程-锁等待关系抽象为一个有向图：
 * <ul>
 *   <li>节点 = 线程（用线程名标识）</li>
 *   <li>有向边 = "Thread-A 等待的锁 被 Thread-B 持有" → A → B（A 依赖 B 释放锁）</li>
 * </ul>
 *
 * <h3>DFS 三色标记</h3>
 * <p>标准的有向图环检测算法，使用三种颜色标记节点状态：
 * <ul>
 *   <li>WHITE（0）— 未访问</li>
 *   <li>GRAY（1）  — 当前 DFS 路径中（在栈上）</li>
 *   <li>BLACK（2）— 已完成访问（该节点及其子树中无环）</li>
 * </ul>
 * 若 DFS 遍历时发现边指向 GRAY 节点，则发现了环（死锁）。
 *
 * @author zeng
 */
@Component
public class DeadlockDetector {

    // DFS 三色标记常量
    private static final int WHITE = 0; // 未访问
    private static final int GRAY  = 1; // 路径中
    private static final int BLACK = 2; // 已完成

    /**
     * 检测结果
     */
    public static class DetectionResult {
        /** 是否发现死锁 */
        private final boolean detected;
        /** 所有死锁链路（每条链路是线程名列表，首尾构成环） */
        private final List<List<String>> chains;
        /** 参与死锁的所有线程名集合（用于前端高亮）*/
        private final Set<String> deadlockThreads;

        public DetectionResult(boolean detected,
                               List<List<String>> chains,
                               Set<String> deadlockThreads) {
            this.detected = detected;
            this.chains = Collections.unmodifiableList(chains);
            this.deadlockThreads = Collections.unmodifiableSet(deadlockThreads);
        }

        public boolean isDetected() { return detected; }
        public List<List<String>> getChains() { return chains; }
        public Set<String> getDeadlockThreads() { return deadlockThreads; }
    }

    /**
     * 执行死锁检测。
     *
     * @param threads 所有线程信息列表
     * @return 检测结果
     */
    public DetectionResult detect(List<ThreadInfo> threads) {
        // -------------------------------------------------------
        // 第一步：构建 锁地址 → 持有者线程名 的映射
        // -------------------------------------------------------
        // Key: 锁地址（如 "0x000000076b572f88"）
        // Value: 持有该锁的线程名
        Map<String, String> lockOwner = new HashMap<>();
        for (ThreadInfo t : threads) {
            for (String lockAddr : t.getLockedMonitors()) {
                lockOwner.put(lockAddr, t.getName());
            }
        }

        // -------------------------------------------------------
        // 第二步：构建线程等待图（Thread Wait-For Graph）
        // -------------------------------------------------------
        // Key: 线程名（等待方）
        // Value: 被等待的线程名（锁持有方）— 即 "等待边"
        Map<String, String> waitForGraph = new HashMap<>();
        for (ThreadInfo t : threads) {
            String lockAddr = t.getWaitingOnLock();
            if (StringUtils.hasText(lockAddr)) {
                String owner = lockOwner.get(lockAddr);
                if (StringUtils.hasText(owner) && !owner.equals(t.getName())) {
                    // Thread t 等待 owner 释放 lockAddr
                    waitForGraph.put(t.getName(), owner);
                }
            }
        }

        // -------------------------------------------------------
        // 第三步：DFS 三色标记 检测环路
        // -------------------------------------------------------
        Map<String, Integer> color = new HashMap<>();
        // 初始化所有节点为 WHITE
        for (String threadName : waitForGraph.keySet()) {
            color.put(threadName, WHITE);
        }
        for (String threadName : waitForGraph.values()) {
            color.putIfAbsent(threadName, WHITE);
        }

        List<List<String>> allChains = new ArrayList<>();
        Set<String> deadlockThreads = new HashSet<>();

        // 对每个 WHITE 节点启动 DFS
        for (String start : color.keySet()) {
            if (color.get(start) != null && color.get(start) == WHITE) {
                LinkedList<String> path = new LinkedList<>();
                dfs(start, waitForGraph, color, path, allChains, deadlockThreads);
            }
        }

        return new DetectionResult(!allChains.isEmpty(), allChains, deadlockThreads);
    }

    /**
     * DFS 递归，检测从 node 出发的路径中是否存在环。
     *
     * @param node           当前节点（线程名）
     * @param waitForGraph   等待图
     * @param color          节点颜色标记
     * @param path           当前 DFS 路径（用于回溯抽取环路）
     * @param allChains      收集到的所有死锁链路
     * @param deadlockThreads 参与死锁的线程名集合
     */
    private void dfs(String node,
                     Map<String, String> waitForGraph,
                     Map<String, Integer> color,
                     LinkedList<String> path,
                     List<List<String>> allChains,
                     Set<String> deadlockThreads) {

        // 标记为 GRAY（当前在路径中）
        color.put(node, GRAY);
        path.addLast(node);

        String next = waitForGraph.get(node);
        if (next != null) {
            int nextColor = color.getOrDefault(next, WHITE);
            if (nextColor == GRAY) {
                // ！发现环路！从路径中提取环的部分
                int cycleStart = path.indexOf(next);
                List<String> chain = new ArrayList<>(path.subList(cycleStart, path.size()));
                chain.add(next); // 首尾相连，明确展示环
                allChains.add(chain);
                deadlockThreads.addAll(chain);
            } else if (nextColor == WHITE) {
                dfs(next, waitForGraph, color, path, allChains, deadlockThreads);
            }
            // BLACK：已检测完，跳过
        }

        // 回溯：标记为 BLACK，从路径移除
        path.removeLast();
        color.put(node, BLACK);
    }
}
