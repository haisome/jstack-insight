package com.zeng.jstackinsight.service.impl;

import com.zeng.jstackinsight.api.response.AnalysisResultVO;
import com.zeng.jstackinsight.converter.AnalysisResultConverter;
import com.zeng.jstackinsight.service.analyzer.DeadlockDetector;
import com.zeng.jstackinsight.service.parser.JStackParser;
import com.zeng.jstackinsight.service.parser.model.JStackDump;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * 分析服务实现
 *
 * <p>编排解析 → 检测 → 转换的完整流程。
 *
 * @author zeng
 */
@Service
public class AnalysisServiceImpl {

    private final JStackParser parser;
    private final DeadlockDetector deadlockDetector;
    private final AnalysisResultConverter converter;

    public AnalysisServiceImpl(JStackParser parser,
                                DeadlockDetector deadlockDetector,
                                AnalysisResultConverter converter) {
        this.parser = parser;
        this.deadlockDetector = deadlockDetector;
        this.converter = converter;
    }

    public JStackParser getParser() {
        return parser;
    }

    /**
     * 分析上传的 jstack 文件。
     *
     * @param file 上传的 .txt 文件
     * @return 分析结果 VO
     * @throws IOException 文件读取失败
     */
    public AnalysisResultVO analyze(MultipartFile file) throws IOException {
        String content = new String(file.getBytes(), StandardCharsets.UTF_8);
        return analyze(content);
    }

    /**
     * 分析 jstack 文本内容。
     *
     * @param content jstack 文件的完整文本
     * @return 分析结果 VO
     */
    public AnalysisResultVO analyze(String content) {
        // 1. FSM 解析
        JStackDump dump = parser.parse(content);

        // 2. DFS 死锁检测
        DeadlockDetector.DetectionResult detection = deadlockDetector.detect(dump.getThreads());

        // 3. 转换 VO 并返回
        return converter.convert(dump, detection);
    }
}
