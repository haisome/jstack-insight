package com.zeng.jstackinsight.api.response;

import lombok.Builder;
import lombok.Data;

/**
 * 分析结果汇总 VO（主响应体）
 *
 * <p>POST /api/v1/analysis/upload 接口的响应 data 字段类型。
 * 聚合了线程状态、锁图、火焰图、死锁链路四大分析结果。
 *
 * @author zeng
 */
@Data
@Builder
public class AnalysisResultVO {

    /** 线程状态汇总（饼图、列表） */
    private ThreadStateVO threadState;

    /** 锁竞争关系图（力导向图） */
    private LockGraphVO lockGraph;

    /** 火焰图（调用树） */
    private FlameGraphVO flameGraph;

    /** 死锁链路详情 */
    private DeadlockChainVO deadlockChain;
}
