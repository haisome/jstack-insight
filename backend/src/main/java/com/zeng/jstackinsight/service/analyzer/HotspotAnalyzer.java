package com.zeng.jstackinsight.service.analyzer;

import com.zeng.jstackinsight.api.response.FlameGraphVO;
import com.zeng.jstackinsight.service.parser.model.ThreadInfo;
import org.springframework.stereotype.Component;

import java.util.*;

/**
 * 热点调用栈分析器
 *
 * <p>将所有线程的调用栈聚合成一棵调用树，用于渲染火焰图（Flame Graph）。
 *
 * <h3>火焰图原理</h3>
 * <p>火焰图横轴表示 CPU 时间（或线程数量），纵轴表示调用深度。
 * 相同前缀路径的调用帧会被合并，最终形成"宽而低"的矩形代表热点方法。
 *
 * <h3>着色规则</h3>
 * <ul>
 *   <li>java.* / javax.* / sun.* → "jdk"（蓝色）</li>
 *   <li>org.springframework.* → "spring"（绿色）</li>
 *   <li>com.* / org.* (非spring) → "app"（橙色）</li>
 *   <li>其他 → "other"（灰色）</li>
 * </ul>
 *
 * @author zeng
 */
@Component
public class HotspotAnalyzer {

    /**
     * 构建火焰图树数据。
     *
     * @param threads 所有线程列表
     * @return 火焰图根节点
     */
    public FlameGraphVO buildFlameGraph(List<ThreadInfo> threads) {
        // 虚拟根节点，代表"所有线程"
        TreeNode root = new TreeNode("all");

        for (ThreadInfo thread : threads) {
            List<String> frames = thread.getStackFrames();
            if (frames.isEmpty()) {
                continue;
            }
            // 火焰图从底部（最外层调用）到顶部（当前执行帧）
            // jstack 的顺序是：第一帧=栈顶（当前执行），最后一帧=栈底（main/run）
            // 我们按 bottom-up 方向聚合（反转帧）
            List<String> reversed = new ArrayList<>(frames);
            Collections.reverse(reversed);

            TreeNode current = root;
            for (String frame : reversed) {
                current = current.getOrCreateChild(frame);
                current.incrementCount();
            }
        }

        // 将内部树结构转换为 VO
        FlameGraphVO.FlameNode rootNode = convertToVO(root);
        return FlameGraphVO.builder().root(rootNode).build();
    }

    /**
     * 递归将内部树节点转换为 VO 节点。
     */
    private FlameGraphVO.FlameNode convertToVO(TreeNode node) {
        List<FlameGraphVO.FlameNode> childrenVO = new ArrayList<>();
        for (TreeNode child : node.children.values()) {
            childrenVO.add(convertToVO(child));
        }

        // 叶子节点（无子节点）的 value = count
        // 非叶子节点的 value = 所有子节点 value 之和（若有子节点，count 意义不大）
        int value = node.count;
        if (!childrenVO.isEmpty() && value == 0) {
            value = childrenVO.stream().mapToInt(FlameGraphVO.FlameNode::getValue).sum();
        }

        return FlameGraphVO.FlameNode.builder()
                .name(shortenFrame(node.frame))
                .fullSignature(node.frame)
                .value(Math.max(value, 1))
                .colorCategory(categorize(node.frame))
                .children(childrenVO.isEmpty() ? null : childrenVO)
                .build();
    }

    /**
     * 截短帧名：只保留方法名部分，避免太长。
     */
    private String shortenFrame(String frame) {
        // 去掉括号内的文件:行号部分
        int parenIdx = frame.indexOf('(');
        String methodPart = parenIdx > 0 ? frame.substring(0, parenIdx) : frame;
        // 只取最后一个点之前的一个层级 + 方法名
        String[] parts = methodPart.split("\\.");
        if (parts.length >= 2) {
            return parts[parts.length - 2] + "." + parts[parts.length - 1];
        }
        return methodPart;
    }

    /**
     * 根据包名分类，决定颜色类别。
     */
    private String categorize(String frame) {
        if (frame == null) return "other";
        if (frame.startsWith("java.") || frame.startsWith("javax.")
                || frame.startsWith("sun.") || frame.startsWith("jdk.")) {
            return "jdk";
        }
        if (frame.startsWith("org.springframework")) {
            return "spring";
        }
        if (frame.startsWith("com.") || frame.startsWith("org.") || frame.startsWith("net.")) {
            return "app";
        }
        return "other";
    }

    // ================================================================
    // 内部树节点（临时数据结构）
    // ================================================================

    private static class TreeNode {
        /** 调用帧完整签名（或 "all" 表示虚拟根节点） */
        final String frame;
        /** 该帧出现的线程数量 */
        int count = 0;
        /** 子节点（Key=帧签名） */
        final LinkedHashMap<String, TreeNode> children = new LinkedHashMap<>();

        TreeNode(String frame) {
            this.frame = frame;
        }

        TreeNode getOrCreateChild(String frame) {
            return children.computeIfAbsent(frame, TreeNode::new);
        }

        void incrementCount() {
            this.count++;
        }
    }
}
