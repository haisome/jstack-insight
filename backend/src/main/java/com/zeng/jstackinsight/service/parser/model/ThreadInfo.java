package com.zeng.jstackinsight.service.parser.model;

import java.util.ArrayList;
import java.util.List;

/**
 * JVM 线程信息领域模型
 *
 * <p>对应 jstack 输出中的一个线程块，例如：
 * <pre>
 * "pool-1-thread-1" #12 prio=5 os_prio=0 tid=0x00007f... nid=0x1a2b waiting for monitor entry [0x...]
 *    java.lang.Thread.State: BLOCKED (on object monitor)
 *         at com.example.Foo.bar(Foo.java:42)
 *         - waiting to lock &lt;0x000000076b572f88&gt; (a java.util.HashMap)
 *         - locked &lt;0x000000076b572f00&gt; (a java.lang.Object)
 * </pre>
 *
 * <h3>锁机制说明</h3>
 * <p>jstack 中涉及两类锁等待：
 * <ul>
 *   <li><b>waiting to lock</b>：等待进入 synchronized 代码块（Monitor 锁）。
 *       线程状态为 BLOCKED。</li>
 *   <li><b>parking to wait for</b>：通过 {@code LockSupport.park()} 挂起，
 *       通常是 AQS（如 ReentrantLock）的内部实现。线程状态为 WAITING/TIMED_WAITING。</li>
 * </ul>
 *
 * @author zeng
 */
public class ThreadInfo {

    /** 线程名称（双引号内的内容） */
    private String name;

    /** 线程编号（#N） */
    private int number;

    /** 线程优先级 */
    private int priority;

    /** JVM 内部线程 ID（十六进制字符串）*/
    private String tid;

    /** 系统原生线程 ID（十六进制，来自 nid=0x...，可与 top -H 对应） */
    private String nid;

    /**
     * 线程状态（大写，来自 "java.lang.Thread.State: XXX"）
     * 取值：NEW / RUNNABLE / BLOCKED / WAITING / TIMED_WAITING / TERMINATED
     */
    private String state;

    /** 调用栈帧列表（按自顶向下顺序，第一个为当前执行帧） */
    private final List<String> stackFrames = new ArrayList<>();

    /**
     * 该线程等待获取的锁地址（Monitor 或 AQS parkBlocker）。
     * 格式：{@code <0x000000076b572f88>}
     */
    private String waitingOnLock;

    /**
     * 该线程等待获取的锁的类型全限定名（如有）。
     * 格式：{@code java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject}
     */
    private String waitingOnLockClass;

    /**
     * 该线程等待获取的锁类型：
     * MONITOR — synchronized 监视器锁
     * PARKING — LockSupport.park / AQS
     */
    private String waitingType;

    /**
     * 该线程持有的监视器锁地址列表（来自 "- locked <0x...>"）
     * 一个线程可以同时持有多个锁（嵌套 synchronized）
     */
    private final List<String> lockedMonitors = new ArrayList<>();

    /**
     * 该线程持有的监视器锁对应的类名列表（与 lockedMonitors 一一对应）。
     * 格式：{@code java.util.HashMap}
     */
    private final List<String> lockedMonitorClasses = new ArrayList<>();

    /** 是否为守护线程（daemon） */
    private boolean daemon;

    /**
     * 是否陷入 Finalizer Trap（Finalizer 线程卡在 finalize() 方法中）
     * 由 {@link com.zeng.jstackinsight.service.analyzer.FinalizerTrapDetector} 设置
     */
    private boolean finalizerTrapped;

    /**
     * 是否正在抛出异常（栈帧中包含 Exception/Error 的 {@code <init>} 构造方法）
     * 由 {@link com.zeng.jstackinsight.service.analyzer.ExceptionDetector} 设置
     */
    private boolean throwingException;

    // =================== Getter / Setter ===================

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public int getNumber() { return number; }
    public void setNumber(int number) { this.number = number; }

    public int getPriority() { return priority; }
    public void setPriority(int priority) { this.priority = priority; }

    public String getTid() { return tid; }
    public void setTid(String tid) { this.tid = tid; }

    public String getNid() { return nid; }
    public void setNid(String nid) { this.nid = nid; }

    public String getState() { return state; }
    public void setState(String state) { this.state = state; }

    public List<String> getStackFrames() { return stackFrames; }

    public String getWaitingOnLock() { return waitingOnLock; }
    public void setWaitingOnLock(String waitingOnLock) { this.waitingOnLock = waitingOnLock; }

    public String getWaitingOnLockClass() { return waitingOnLockClass; }
    public void setWaitingOnLockClass(String waitingOnLockClass) { this.waitingOnLockClass = waitingOnLockClass; }

    public String getWaitingType() { return waitingType; }
    public void setWaitingType(String waitingType) { this.waitingType = waitingType; }

    public List<String> getLockedMonitors() { return lockedMonitors; }

    public List<String> getLockedMonitorClasses() { return lockedMonitorClasses; }

    public boolean isDaemon() { return daemon; }
    public void setDaemon(boolean daemon) { this.daemon = daemon; }

    public boolean isFinalizerTrapped() { return finalizerTrapped; }
    public void setFinalizerTrapped(boolean finalizerTrapped) { this.finalizerTrapped = finalizerTrapped; }

    public boolean isThrowingException() { return throwingException; }
    public void setThrowingException(boolean throwingException) { this.throwingException = throwingException; }

    @Override
    public String toString() {
        return "ThreadInfo{name='" + name + "', nid=" + nid + ", state=" + state + "}";
    }
}
