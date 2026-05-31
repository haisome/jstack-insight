package com.zeng.jstackinsight.api.response;

import lombok.Builder;
import lombok.Data;

import java.util.List;

/**
 * 死锁链路详情 VO
 *
 * <p>当 {@link DeadlockDetector} 通过 DFS 检测到环路时，返回本 VO。
 * 前端在「概览」页和「锁图」页均会渲染死锁警告。
 *
 * @author zeng
 */
@Data
@Builder
public class DeadlockChainVO {

    /** 是否存在死锁 */
    private boolean detected;

    /** 所有死锁链路（每条链路为线程名列表，首尾相连构成环） */
    private List<List<String>> chains;

    /** 人类可读的死锁描述 */
    private List<String> descriptions;
}
