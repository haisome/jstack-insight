package com.zeng.jstackinsight;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * JStack Insight 启动类
 *
 * <p>架构说明：模块化单体（Modular Monolith）
 * <ul>
 *   <li>{@code api/}     — API 契约层（DTO/VO），未来可独立发布为 SDK</li>
 *   <li>{@code service/parser/} — 零第三方依赖的手写 FSM 解析引擎</li>
 *   <li>{@code service/analyzer/} — 死锁检测（DFS）、热点聚合</li>
 * </ul>
 *
 * @author zeng
 * @since 1.0.0
 */
@SpringBootApplication
public class JstackInsightApplication {

    public static void main(String[] args) {
        SpringApplication.run(JstackInsightApplication.class, args);
        System.out.println("==============================================");
        System.out.println("  JStack Insight 已启动！");
        System.out.println("  首页地址(需前端build): http://localhost:9595/index.html");
        System.out.println("==============================================");
    }
}
