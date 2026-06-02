package com.zeng.jstackinsight.service.parser.internal;

import com.zeng.jstackinsight.service.parser.model.JStackDump;
import com.zeng.jstackinsight.service.parser.model.ThreadInfo;
import org.springframework.util.StringUtils;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * jstack 行扫描 + 有限状态机（FSM）解析器
 *
 * <h2>核心设计：有限状态机（FSM）</h2>
 * <p>整个解析过程维护一个 {@link ParserState} 状态枚举，逐行扫描输入文本，
 * 根据行内容触发状态转移：
 *
 * <pre>
 *  INIT ──(遇到线程头行)──► THREAD_HEADER
 *                                │
 *                    (遇到 "java.lang.Thread.State:")
 *                                ▼
 *                          THREAD_STATE
 *                                │
 *                    (遇到 "\tat " 调用帧)
 *                                ▼
 *                          STACK_FRAMES  ◄──(继续 \tat 帧)──┐
 *                                │                          │
 *                    (遇到空行)   │        (继续 - locked/waiting to lock 等)
 *                                ▼
 *                      THREAD_END ──(写入当前 thread)──► INIT
 * </pre>
 *
 * <h2>为什么不用巨型正则</h2>
 * <p>jstack 输出格式因 JDK 版本（8/11/17/21）略有差异，行扫描+FSM 对异常行
 * 有更强的容错性，也更易于维护和单元测试。
 *
 * <h2>支持的锁注解格式</h2>
 * <ul>
 *   <li>{@code - locked <0x...> (a ClassName)}   — 持有监视器锁</li>
 *   <li>{@code - waiting to lock <0x...>}         — 等待监视器锁（BLOCKED）</li>
 *   <li>{@code - parking to wait for <0x...>}     — AQS park 挂起（WAITING）</li>
 *   <li>{@code - waiting on <0x...>}              — Object.wait() 挂起</li>
 * </ul>
 *
 * @author zeng
 */
public class JStackLineScanner {

    // ================================================================
    // 正则模式（精简，仅用于关键字段提取，非整行匹配）
    // ================================================================

    /** 线程头行：匹配线程名、是否 daemon、#编号、prio、tid、nid */
    private static final Pattern THREAD_HEADER_PATTERN = Pattern.compile(
            "^\"(.+?)\"\\s*(#(\\d+))?\\s*(daemon)?\\s*prio=(\\d+)\\s+.*tid=(0x[0-9a-fA-F]+)\\s+nid=(0x[0-9a-fA-F]+)");

    /** 线程状态行：java.lang.Thread.State: BLOCKED (on object monitor) */
    private static final Pattern THREAD_STATE_PATTERN = Pattern.compile(
            "^\\s+java\\.lang\\.Thread\\.State:\\s+(\\w+)");

    /** 调用帧行：\tat xxx.yyy.Zzz.method(File.java:42) */
    private static final Pattern STACK_FRAME_PATTERN = Pattern.compile(
            "^\\s+at\\s+(.+)");

    /** 持有锁行：- locked <0x...> (a xxx.Class) */
    private static final Pattern LOCKED_PATTERN = Pattern.compile(
            "^\\s+- locked <(0x[0-9a-fA-F]+)>(?:\\s+\\(a\\s+(.+?)\\))?\\s*$");

    /** 等待监视器锁行：- waiting to lock <0x...> (a xxx.Class) */
    private static final Pattern WAITING_TO_LOCK_PATTERN = Pattern.compile(
            "^\\s+- waiting to lock <(0x[0-9a-fA-F]+)>(?:\\s+\\(a\\s+(.+?)\\))?\\s*$");

    /** AQS park 等待行：- parking to wait for <0x...> (a xxx.Class) */
    private static final Pattern PARKING_PATTERN = Pattern.compile(
            "^\\s+- parking to wait for\\s+<(0x[0-9a-fA-F]+)>(?:\\s+\\(a\\s+(.+?)\\))?\\s*$");

    /** Object.wait() 等待行：- waiting on <0x...> (a xxx.Class) */
    private static final Pattern WAITING_ON_PATTERN = Pattern.compile(
            "^\\s+- waiting on <(0x[0-9a-fA-F]+)>(?:\\s+\\(a\\s+(.+?)\\))?\\s*$");

    /** "Locked ownable synchronizers:" 段头 — JUC 锁（ReentrantLock 等）的持有信息 */
    private static final Pattern OWNED_SYNC_HEADER = Pattern.compile(
            "^\\s*Locked ownable synchronizers:\\s*$");

    /** Locked ownable synchronizers 段内的锁行：- <0x...> (a xxx.Class) */
    private static final Pattern OWNED_SYNC_LINE = Pattern.compile(
            "^\\s+- <(0x[0-9a-fA-F]+)>(?:\\s+\\(a\\s+(.+?)\\))?\\s*$");

    // ================================================================
    // FSM 状态定义
    // ================================================================

    /**
     * 解析器内部状态枚举
     * <p>
     * jstack 线程块结构（以 JUC 死锁场景为例）：
     * <pre>
     *   "Thread-3" ...                    ← INIT → THREAD_HEADER
     *      java.lang.Thread.State: ...    ← THREAD_HEADER → STACK_FRAMES
     *      at xxx (...)
     *      - parking to wait for  <...>
     *      at xxx (...)
     *      ...                            ← STACK_FRAMES 逐行解析
     *      at java.lang.Thread.run(...)
     *      （空行）                        ← STACK_FRAMES → POST_STACK（不能立即 finalize!）
     *      Locked ownable synchronizers:  ← POST_STACK → OWNED_SYNCS
     *      - <0x...> (...)                ← OWNED_SYNCS 解析 JUC 锁
     *      （空行）                        ← OWNED_SYNCS → finalized → INIT
     *   "Thread-2" ...
     * </pre>
     */
    private enum ParserState {
        /** 初始/空闲状态，等待下一个线程头 */
        INIT,
        /** 已读到线程头，等待 Thread.State 行 */
        THREAD_HEADER,
        /** 已读到状态行，开始收集调用栈 */
        STACK_FRAMES,
        /** 栈帧结束后的空行 — 等待判断是否有 "Locked ownable synchronizers" 段 */
        POST_STACK,
        /** 正在解析 "Locked ownable synchronizers" 段 */
        OWNED_SYNCS
    }

    // ================================================================
    // 公共解析入口
    // ================================================================

    /**
     * 解析 jstack 文本，返回结构化的 {@link JStackDump}。
     *
     * @param content jstack 文件的完整文本内容
     * @return 解析结果
     */
    public JStackDump parse(String content) {
        JStackDump dump = new JStackDump();
        String[] lines = content.split("\\r?\\n");

        ParserState state = ParserState.INIT;
        ThreadInfo current = null;

        for (String line : lines) {
            switch (state) {

                case INIT:
                    // 尝试识别线程头行
                    current = tryParseThreadHeader(line);
                    if (current != null) {
                        state = ParserState.THREAD_HEADER;
                    } else {
                        // 解析 JVM 信息头（首行通常是时间戳）
                        if (dump.getTimestamp() == null && !line.trim().isEmpty()
                                && !line.startsWith("Full thread dump")) {
                            dump.setTimestamp(line.trim());
                        } else if (line.startsWith("Full thread dump")) {
                            dump.setJvmInfo(line.trim());
                        }
                    }
                    break;

                case THREAD_HEADER:
                    // 等待 Thread.State 行
                    Matcher stateMatcher = THREAD_STATE_PATTERN.matcher(line);
                    if (stateMatcher.find()) {
                        current.setState(stateMatcher.group(1).toUpperCase());
                        state = ParserState.STACK_FRAMES;
                    } else if (line.trim().isEmpty()) {
                        // 空行意味着这是个没有 Java 状态的 JVM 内部线程，直接入库
                        finalizeThread(dump, current);
                        current = null;
                        state = ParserState.INIT;
                    }
                    break;

                case STACK_FRAMES:
                    if (line.trim().isEmpty()) {
                        // 空行 — 不能立即 finalize！可能后面有 "Locked ownable synchronizers"
                        state = ParserState.POST_STACK;
                    } else {
                        // 解析各类调用帧和锁注解
                        parseStackLine(line, current);
                    }
                    break;

                case POST_STACK:
                    if (OWNED_SYNC_HEADER.matcher(line).find()) {
                        // 进入 JUC 锁持有段
                        state = ParserState.OWNED_SYNCS;
                    } else if (line.trim().isEmpty()) {
                        // 连续空行，保持等待
                    } else if (line.startsWith("\"")) {
                        // 遇到了下一个线程头 → 先 finalize 当前线程，再处理新线程头
                        finalizeThread(dump, current);
                        current = tryParseThreadHeader(line);
                        if (current != null) {
                            state = ParserState.THREAD_HEADER;
                        } else {
                            state = ParserState.INIT;
                        }
                    } else {
                        // 其他非空行 → finalize 当前线程，回到 INIT 重新处理此行
                        finalizeThread(dump, current);
                        current = tryParseThreadHeader(line);
                        if (current != null) {
                            state = ParserState.THREAD_HEADER;
                        } else {
                            state = ParserState.INIT;
                        }
                    }
                    break;

                case OWNED_SYNCS:
                    Matcher syncLine = OWNED_SYNC_LINE.matcher(line);
                    if (syncLine.find()) {
                        // 收集 JUC 锁地址到 lockedMonitors
                        if (current != null) {
                            current.getLockedMonitors().add(syncLine.group(1));
                            String cls = syncLine.group(2);
                            if (cls != null) {
                                current.getLockedMonitorClasses().add(cls);
                            }
                        }
                    } else if ("- None".equals(line.trim()) || "- none".equals(line.trim())) {
                        // 该线程不持有任何 JUC 锁
                    } else if (line.trim().isEmpty()) {
                        // 空行 = Owned Sync 段结束 → finalize
                        finalizeThread(dump, current);
                        current = null;
                        state = ParserState.INIT;
                    } else {
                        // 未知行（不太可能出现），finalize 并回退
                        finalizeThread(dump, current);
                        current = null;
                        state = ParserState.INIT;
                    }
                    break;
            }
        }

        // 文件末尾可能没有空行，处理最后一个线程
        if (current != null) {
            finalizeThread(dump, current);
        }

        return dump;
    }

    // ================================================================
    // 私有辅助方法
    // ================================================================

    /**
     * 尝试解析线程头行，失败返回 null。
     *
     * <p>线程头格式（JDK 8 示例）：
     * <pre>
     * "GC task thread#0 (ParallelGC)" os_prio=0 tid=0x00007f... nid=0x1234 runnable
     * "pool-1-thread-1" #12 daemon prio=5 os_prio=0 tid=0x... nid=0x1a2b waiting for monitor entry [0x...]
     * </pre>
     */
    private ThreadInfo tryParseThreadHeader(String line) {
        if (!line.startsWith("\"")) {
            return null;
        }

        ThreadInfo info = new ThreadInfo();

        // 提取线程名（双引号之间的内容）
        int nameEnd = line.lastIndexOf('"', line.length() - 1);
        // 找到第二个引号
        int nameStart = line.indexOf('"');
        if (nameStart >= 0 && nameEnd > nameStart) {
            info.setName(line.substring(nameStart + 1, nameEnd));
        } else {
            info.setName(line.trim());
        }

        // 是否为 daemon 线程
        info.setDaemon(line.contains(" daemon "));

        // 用正则提取 #编号、tid、nid
        Matcher m = THREAD_HEADER_PATTERN.matcher(line);
        if (m.find()) {
            if (StringUtils.hasText(m.group(3))) {
                try { info.setNumber(Integer.parseInt(m.group(3))); } catch (NumberFormatException ignored) {}
            }
            if (StringUtils.hasText(m.group(5))) {
                try { info.setPriority(Integer.parseInt(m.group(5))); } catch (NumberFormatException ignored) {}
            }
            info.setTid(m.group(6));
            info.setNid(m.group(7));
        }

        return info;
    }

    /**
     * 解析调用栈内的单行，包括：
     * <ul>
     *   <li>调用帧 ({@code at ...})</li>
     *   <li>持有锁 ({@code - locked <0x...>})</li>
     *   <li>等待锁 ({@code - waiting to lock <0x...>})</li>
     *   <li>AQS park ({@code - parking to wait for <0x...>})</li>
     *   <li>Object.wait ({@code - waiting on <0x...>})</li>
     * </ul>
     * 注："Locked ownable synchronizers" 段由 FSM 的 OWNED_SYNCS 状态单独处理。
     */
    private void parseStackLine(String line, ThreadInfo thread) {

        // 调用帧
        Matcher frameMatcher = STACK_FRAME_PATTERN.matcher(line);
        if (frameMatcher.find()) {
            thread.getStackFrames().add(frameMatcher.group(1).trim());
            return;
        }

        // 持有监视器锁
        Matcher lockedMatcher = LOCKED_PATTERN.matcher(line);
        if (lockedMatcher.find()) {
            thread.getLockedMonitors().add(lockedMatcher.group(1));
            String cls = lockedMatcher.group(2);
            if (cls != null) {
                thread.getLockedMonitorClasses().add(cls);
            }
            return;
        }

        // 等待监视器锁（BLOCKED）
        Matcher waitToLockMatcher = WAITING_TO_LOCK_PATTERN.matcher(line);
        if (waitToLockMatcher.find()) {
            thread.setWaitingOnLock(waitToLockMatcher.group(1));
            thread.setWaitingType("MONITOR");
            String cls = waitToLockMatcher.group(2);
            if (cls != null) {
                thread.setWaitingOnLockClass(cls);
            }
            return;
        }

        // AQS park 挂起（WAITING / TIMED_WAITING）
        Matcher parkMatcher = PARKING_PATTERN.matcher(line);
        if (parkMatcher.find()) {
            thread.setWaitingOnLock(parkMatcher.group(1));
            thread.setWaitingType("PARKING");
            String cls = parkMatcher.group(2);
            if (cls != null) {
                thread.setWaitingOnLockClass(cls);
            }
            return;
        }

        // Object.wait() 挂起
        Matcher waitOnMatcher = WAITING_ON_PATTERN.matcher(line);
        if (waitOnMatcher.find()) {
            // waiting on 时，当前线程实际上也持有该锁（先 lock 再 wait()），
            // 并且正在等待被 notify，此处仅记录等待地址
            thread.setWaitingOnLock(waitOnMatcher.group(1));
            thread.setWaitingType("OBJECT_WAIT");
            String cls = waitOnMatcher.group(2);
            if (cls != null) {
                thread.setWaitingOnLockClass(cls);
            }
        }
    }

    /**
     * 将已解析完毕的线程信息写入 dump。
     * 仅入库有效线程（至少有名称的线程）。
     */
    private void finalizeThread(JStackDump dump, ThreadInfo thread) {
        if (thread != null && StringUtils.hasText(thread.getName())) {
            // 如果状态为 null，设置默认值（JVM 内部线程可能没有 Java 状态）
            if (thread.getState() == null) {
                thread.setState("UNKNOWN");
            }
            dump.getThreads().add(thread);
        }
    }
}
