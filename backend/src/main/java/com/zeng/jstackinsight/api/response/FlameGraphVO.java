package com.zeng.jstackinsight.api.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 火焰图数据 VO（树状结构）
 *
 * <p>火焰图（Flame Graph）本质上是一棵调用树，X 轴表示线程/样本数量，
 * Y 轴表示栈深度。前端使用 Ant Design Charts 的 Treemap 或 Sunburst 渲染。
 *
 * <p>数据构造逻辑：
 * <ol>
 *   <li>遍历所有线程的调用栈（从栈顶到栈底方向反转）</li>
 *   <li>将相同路径前缀的调用帧合并，统计出现次数（weight）</li>
 *   <li>按包名着色：{@code java.*} 蓝色，{@code com.*} 橙色，{@code sun.*} 绿色，其他 灰色</li>
 * </ol>
 *
 * @author zeng
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FlameGraphVO {

    /** 根节点（虚拟根，代表全部线程） */
    private FlameNode root;

    /**
     * 火焰图树节点
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class FlameNode {
        /** 节点名称（方法签名或包名） */
        private String name;
        /** 该节点覆盖的线程/样本数量（用于面积计算） */
        private int value;
        /**
         * 着色分类（前端据此映射颜色）：
         * java / javax / sun → "jdk"
         * com.zeng / com.* → "app"
         * org.springframework → "spring"
         * other → "other"
         */
        private String colorCategory;
        /** 完整方法签名（Hover Tooltip 显示） */
        private String fullSignature;
        /** 子节点列表 */
        private List<FlameNode> children;
    }
}
