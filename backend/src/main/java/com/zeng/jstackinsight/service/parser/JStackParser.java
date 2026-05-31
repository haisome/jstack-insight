package com.zeng.jstackinsight.service.parser;

import com.zeng.jstackinsight.service.parser.internal.JStackLineScanner;
import com.zeng.jstackinsight.service.parser.model.JStackDump;
import org.springframework.stereotype.Component;

/**
 * jstack 解析器门面（Facade）
 *
 * <p>对外暴露统一的解析接口，内部委托给 {@link JStackLineScanner}（行扫描+FSM）。
 * 若将来需要支持 JFR / async-profiler 等其他格式，只需在此扩展。
 *
 * <p>零第三方解析依赖：全部解析逻辑由 {@link JStackLineScanner} 手写实现。
 *
 * @author zeng
 */
@Component
public class JStackParser {

    private final JStackLineScanner scanner = new JStackLineScanner();

    /**
     * 解析 jstack 输出文本。
     *
     * @param content jstack 文件原始文本（UTF-8 编码）
     * @return 结构化的线程转储对象
     * @throws IllegalArgumentException 若 content 为空
     */
    public JStackDump parse(String content) {
        if (content == null || content.trim().isEmpty()) {
            throw new IllegalArgumentException("jstack 内容不能为空");
        }
        return scanner.parse(content);
    }
}
