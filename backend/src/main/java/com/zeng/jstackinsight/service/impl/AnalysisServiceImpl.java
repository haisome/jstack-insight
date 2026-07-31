package com.zeng.jstackinsight.service.impl;

import com.zeng.jstackinsight.api.response.AnalysisResultVO;
import com.zeng.jstackinsight.converter.AnalysisResultConverter;
import com.zeng.jstackinsight.service.analyzer.DeadlockDetector;
import com.zeng.jstackinsight.service.analyzer.ExceptionDetector;
import com.zeng.jstackinsight.service.analyzer.FinalizerTrapDetector;
import com.zeng.jstackinsight.service.parser.JStackParser;
import com.zeng.jstackinsight.service.parser.model.JStackDump;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.*;
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
    private final FinalizerTrapDetector finalizerTrapDetector;
    private final ExceptionDetector exceptionDetector;
    private final AnalysisResultConverter converter;

    public AnalysisServiceImpl(JStackParser parser,
                                DeadlockDetector deadlockDetector,
                                FinalizerTrapDetector finalizerTrapDetector,
                                ExceptionDetector exceptionDetector,
                                AnalysisResultConverter converter) {
        this.parser = parser;
        this.deadlockDetector = deadlockDetector;
        this.finalizerTrapDetector = finalizerTrapDetector;
        this.exceptionDetector = exceptionDetector;
        this.converter = converter;
    }

    /**
     * 快速检测文本前几 KB 是否像是 jstack 输出。
     */
    private boolean looksLikeJstack(String head) {
        if (head.contains("tid=0x") && head.contains("nid=0x")) return true;
        if (head.contains("Full thread dump")) return true;
        if (head.contains("java.lang.Thread.State")) return true;
        return false;
    }

    public JStackParser getParser() {
        return parser;
    }

    /**
     * 分析上传的 jstack 文件（仅支持 .txt）。
     */
    public AnalysisResultVO analyze(MultipartFile file) throws IOException {
        String filename = file.getOriginalFilename();
        if (filename == null) filename = "unknown";

        try (InputStream rawStream = file.getInputStream()) {
            // 快速校验：读前 2KB 检查是否为 jstack 格式，拒绝恶意大文件
            byte[] head = new byte[2048];
            int read = rawStream.read(head, 0, head.length);
            if (read <= 0) {
                throw new IllegalArgumentException("文件内容为空");
            }
            String headStr = new String(head, 0, read, StandardCharsets.UTF_8);
            if (!looksLikeJstack(headStr)) {
                throw new IllegalArgumentException(
                        "文件格式不正确：未检测到 jstack 线程转储特征");
            }

            InputStream combined = new SequenceInputStream(
                    new ByteArrayInputStream(head, 0, read), rawStream);
            JStackDump dump = parser.parse(combined);

            // 分类检测
            DeadlockDetector.DetectionResult deadlockResult = deadlockDetector.detect(dump.getThreads());
            FinalizerTrapDetector.DetectionResult finalizerTrapResult = finalizerTrapDetector.detect(dump.getThreads());
            ExceptionDetector.DetectionResult exceptionResult = exceptionDetector.detect(dump.getThreads());

            return converter.convert(dump, deadlockResult, finalizerTrapResult, exceptionResult);
        }
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

        // 2. 各类检测
        DeadlockDetector.DetectionResult deadlockResult = deadlockDetector.detect(dump.getThreads());
        FinalizerTrapDetector.DetectionResult finalizerTrapResult = finalizerTrapDetector.detect(dump.getThreads());
        ExceptionDetector.DetectionResult exceptionResult = exceptionDetector.detect(dump.getThreads());

        // 3. 转换 VO 并返回
        return converter.convert(dump, deadlockResult, finalizerTrapResult, exceptionResult);
    }
}
