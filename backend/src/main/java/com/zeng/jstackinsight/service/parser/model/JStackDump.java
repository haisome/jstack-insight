package com.zeng.jstackinsight.service.parser.model;

import java.util.ArrayList;
import java.util.List;

/**
 * jstack 解析结果的根领域模型
 *
 * <p>一次 jstack 输出通常包含：
 * <ol>
 *   <li>JVM 基本信息头（时间戳、JVM 版本等）</li>
 *   <li>N 个线程信息块（{@link ThreadInfo}）</li>
 *   <li>JNI global references 统计（尾部）</li>
 * </ol>
 *
 * @author zeng
 */
public class JStackDump {

    /** jstack 转储的原始时间戳行（如有） */
    private String timestamp;

    /** JVM 版本信息（如有） */
    private String jvmInfo;

    /** 解析出的所有线程信息 */
    private final List<ThreadInfo> threads = new ArrayList<>();

    /** JNI global references 数量（可选） */
    private int jniGlobalRefs;

    public String getTimestamp() { return timestamp; }
    public void setTimestamp(String timestamp) { this.timestamp = timestamp; }

    public String getJvmInfo() { return jvmInfo; }
    public void setJvmInfo(String jvmInfo) { this.jvmInfo = jvmInfo; }

    public List<ThreadInfo> getThreads() { return threads; }

    public int getJniGlobalRefs() { return jniGlobalRefs; }
    public void setJniGlobalRefs(int jniGlobalRefs) { this.jniGlobalRefs = jniGlobalRefs; }
}
