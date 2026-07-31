# JStack Insight

> 企业级 JVM 线程转储（jstack）可视化分析平台

[![JDK](https://img.shields.io/badge/JDK-1.8%2B-blue)](https://adoptium.net)
[![Spring Boot](https://img.shields.io/badge/Spring%20Boot-2.7.18-brightgreen)](https://spring.io/projects/spring-boot)
[![React](https://img.shields.io/badge/React-18.3.1-61dafb)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.9.5-3178c6)](https://www.typescriptlang.org)

---

## 简介

**JStack Insight** 是一个面向 Java 开发者和 SRE 的 jstack 线程转储分析工具。上传 `jstack` 输出的文本文件，即可获得线程状态分布、锁竞争图、火焰图、死锁检测、CPU 分析等多维度结果。分析完成后生成唯一分享链接，各面板数据按需懒加载。

设计灵感来源于 [fastthread.io](https://fastthread.io)。

---

## 核心功能

| 模块 | 处理逻辑 | 说明 |
|------|----------|------|
| **线程状态概览** | 遍历所有线程按 `state` 分组统计，生成饼图 + 指标卡 | 线程状态分布一览 |
| **线程列表** | 分页 + 名称/状态搜索过滤；展开时通过分桶索引按需加载调用栈 | 按需加载，避免一次拉取全量栈帧 |
| **线程组分析** | 按线程名中首个 `-` 前的前缀自动分组，统计各组状态分布 | 快速识别线程池堆积 |
| **相同堆栈分析** | 后端加载全量线程，按 `stackTrace.join('\0')` 分组，返回 ~50KB 预分组结果 | 快速发现大量同栈线程（死循环/线程池满） |
| **锁竞争图** | 解析 `lockedMonitors` + `waitingOnLock` 构建有向图，D3.js 力导向渲染 | 线程↔锁竞争关系可视化 |
| **死锁检测** | DFS 三色标记算法遍历线程依赖图，检测 Monitor 锁 + JUC 锁环路 | 自动识别循环死锁链路 |
| **火焰图** | 聚合所有线程调用栈，构建前缀树，D3 Partition Ice Chart 按宽度展示热点 | 栈帧级别的 CPU 热点定位 |
| **CPU 线程推测** | 根据线程名关键词（GC/Cleaner/IO/JDBC 等）+ 状态启发式分类 | 无需上传 top 文件即可初步定位 |
| **精准 CPU 采集** | 上传 `top -H` 输出，通过 PID(十进制)↔nid(十六进制) 关联，返回精确 CPU% | 精确到单个线程的 CPU 占用率 |
| **报告分享** | 分析结果持久化为 JSON 分桶文件，生成唯一链接；默认 24h 有效，分享可延长至 48h | 不依赖数据库，文件系统直接存储 |
| **中英文切换** | i18next 框架，`zh-CN.ts` / `en.ts` 独立翻译文件 | 一键切换 |

---

## 技术栈

### 后端

- **JDK 1.8**
- **Spring Boot 2.7.18**
- **Maven** 构建
- **Lombok**、**Apache Commons Lang3**
- **SpringDoc OpenAPI 3**（Swagger UI 自动文档）
- **Spring AOP**（上传审计切面）

### 前端

- **React 18** + **TypeScript 4.9**
- **Ant Design 5** UI 组件库
- **@ant-design/charts** 图表
- **D3.js 7** 力导向图 + 火焰图
- **i18next** 国际化

---

## 项目结构

```
jstack-insight/
├── backend/
│   ├── pom.xml
│   └── src/main/
│       ├── resources/
│       │   ├── application.yml       # 端口 9595，上传限制 10MB
│       │   └── static/               # 生产构建后前端静态文件
│       └── java/com/zeng/jstackinsight/
│           ├── controller/           # REST API
│           ├── service/
│           │   ├── parser/           # jstack FSM 解析器 + top 文件解析
│           │   ├── analyzer/         # 死锁检测 + Finalizer + 异常检测
│           │   ├── impl/             # 分析服务 + 报告持久化
│           │   └── model/            # 解析结果对象
│           ├── api/                  # VO 数据类
│           ├── aspect/               # 上传审计切面 + IP 日志过滤器
│           ├── converter/            # model → VO 转换
│           └── exception/            # 全局异常处理
│
├── frontend/
│   ├── package.json                  # proxy -> localhost:9595
│   └── src/
│       ├── pages/
│       │   ├── upload/               # 上传页
│       │   └── result/               # 报告页（通用 ResultPage + 按 UUID 分享 ReportResultPage）
│       ├── types/                    # TypeScript 类型定义
│       ├── services/                 # Axios HTTP 客户端
│       └── i18n/                     # 中/英文翻译
│
└── jstackInsightData/                # 运行时报告存储（gitignore）
```

---

## 报告存储与懒加载

### 存储结构

每个报告按 UUID 独立存储，线程详情按 50 条/桶分批，避免单文件过大或文件数暴增：

```
jstackInsightData/reports/{yyyy-MM-dd}/{uuid}/
├── meta.json              # 元数据：UUID/文件名/过期时间/线程数/死锁标记 (~200B)
├── threads-summary.json   # 线程摘要不含调用栈 (~200KB)
├── threads-idx.json       # tid → 分桶编号索引 (~10KB)
├── threads/
│   ├── 0.json             # 完整线程详情分桶，每桶 ~50 条 (~100KB)
│   └── 1.json
├── lock-graph.json        # 锁竞争图 (~50KB)
├── flame-graph.json       # 火焰图 (~200KB)
└── deadlocks.json         # 死锁链路 (~5KB)
```

### 按需加载

| Tab | 首屏请求 | 触发条件 |
|---|---|---|
| 概览 | `summary`(~200B) + `threads-summary`(~200KB) | 首次打开 |
| 线程列表 | 同上 + `threads-idx`(~10KB) | 首次切到此 tab |
| 展开单线程 | `thread-bucket/{n}`(~100KB) | 点击展开箭头 |
| 相同堆栈 | `stack-groups`(~50KB) | 首次切到此 tab |
| 锁图/死锁 | `lock-graph` + `deadlocks` | 首次切到此 tab |
| 火焰图 | `flame-graph` | 首次切到此 tab |
| CPU 推测 | 使用已加载的 `threads-summary` | - |
| 精准 CPU | `top-cpu-with-report/{uuid}` | 上传 top 文件后 |

前端持有 `threads-idx` 索引和分桶缓存（React state），同一分桶内点击多个线程不会重复请求后端。

### 有效期与清理

- 默认 24 小时自动过期
- 点击「分享」按钮：若剩余不足 48h 则延至 48h，够用则不延长
- 清理线程每 30 分钟运行一次，过期报告最迟半小时内删除
- 启动时也立即执行一次清理

---

## 快速开始

### 环境要求

- **JDK 1.8+**
- **Node.js 16+**（含 npm）
- **Maven 3.6+**

### 开发模式

```bash
# 1. 启动后端（端口 9595）
cd backend
mvn spring-boot:run

# 2. 启动前端（端口 3000，自动代理到 9595）
cd frontend
npm install
npm start
```

浏览器打开 http://localhost:3000。

### 生产构建

```bash
# 构建前端
cd frontend
npm run build

# 打包后端
cd backend
mvn clean package -DskipTests

# 运行
java -jar target/jstack-insight-1.0.0-SNAPSHOT.jar
```

访问 http://localhost:9595/index.html

---

## API 接口

### 上传 & 分析

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/analysis/upload` | 上传 jstack 文件（.txt，≤10MB），执行分析并持久化，返回 UUID |
| POST | `/api/v1/analysis/top-cpu-with-report/{uuid}` | 上传 top -H 文件，基于已有报告 UUID 进行精准 CPU 关联 |

### 报告按需加载

| 方法 | 路径 | 说明 | 响应量 |
|------|------|------|--------|
| GET | `/api/v1/report/{uuid}/summary` | 报告摘要：文件名、过期时间、线程数、死锁标记 | ~200B |
| GET | `/api/v1/report/{uuid}/threads-summary` | 全部线程摘要（不含调用栈），供概览/列表/CPU分析使用 | ~200KB |
| GET | `/api/v1/report/{uuid}/threads-idx` | tid → 分桶编号索引，前端持有后按需请求分桶 | ~10KB |
| GET | `/api/v1/report/{uuid}/thread-bucket/{n}` | 第 n 个分桶的完整线程详情（~50条，含调用栈） | ~100KB |
| GET | `/api/v1/report/{uuid}/stack-groups` | 相同堆栈预分组结果（样本栈帧 + 线程名列表） | ~50KB |
| GET | `/api/v1/report/{uuid}/lock-graph` | 锁竞争有向图（节点 + 边） | ~50KB |
| GET | `/api/v1/report/{uuid}/flame-graph` | 火焰图树状结构 | ~200KB |
| GET | `/api/v1/report/{uuid}/deadlocks` | 死锁检测结果与链路详情 | ~5KB |
| POST | `/api/v1/report/{uuid}/extend` | 延长有效期至 48h，返回新的过期时间戳 | - |

启动后访问 http://localhost:9595/swagger-ui/index.html 查看完整文档。

---

## 配置

### 后端 (`application.yml`)

```yaml
server:
  port: 9595

spring:
  servlet:
    multipart:
      max-file-size: 10MB
      max-request-size: 10MB

jstack-insight:
  report:
    dir: jstackInsightData/reports    # 存储目录
    expire-hours: 24                  # 默认有效期（小时）
    extend-hours: 48                  # 分享后延长至（小时）
```

日志配置见 `src/main/resources/logback-spring.xml`（控制台格式含客户端 IP）。

### 前端

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `REACT_APP_API_BASE_URL` | API 基地址 | `http://localhost:9595` |

---

## 安全性

- **内容校验**：解析前读取前 2KB 检测 jstack 特征（`tid=0x`/`Full thread dump`/`java.lang.Thread.State`），不匹配立即拒绝
- **审计日志**：所有上传操作通过 AOP 切面记录 IP、文件名、大小、处理耗时、UUID
- **IP 追踪**：每个请求自动注入客户端真实 IP（支持 X-Forwarded-For 代理场景）
- **UUID**：使用 `UUID.randomUUID()`（122 bit 随机），暴力遍历不可行，无碰撞风险

---

## 代码仓库

[![GitHub](https://img.shields.io/badge/GitHub-haisome%2Fjstack--insight-181717?style=flat-square&logo=github)](https://github.com/haisome/jstack-insight)
[![Gitee](https://img.shields.io/badge/Gitee-Z--HaiSome%2Fjstack--insight-c71d23?style=flat-square&logo=gitee)](https://gitee.com/Z-HaiSome/jstack-insight)

---

## 参考资源

本项目的线程检测与分析模式参考自 [fastthread.io](https://fastthread.io) 专业博客：

| 主题 | 链接 | 说明 |
|------|------|------|
| **死锁检测** | [Deadlock](https://blog.fastthread.io/deadlock/) | Monitor 锁与 JUC 锁的环路依赖检测原理 |
| **Finalizer 陷阱** | [Leprechaun Trap](https://blog.fastthread.io/thread-dump-analysis-pattern-leprechaun-trap/) | Finalizer 线程卡在 finalize() 中导致 OOM 的检测模式 |
| **异常线程检测** | [Throwing Exception](https://blog.fastthread.io/threads-throwing-exception/) | 通过栈帧中的 Exception/Error 构造方法识别异常线程 |
| **RUNNABLE ≠ 运行中** | [Really Running](https://blog.fastthread.io/really-running/) | RUNNABLE 状态线程未必真正占用 CPU |
| **重复性劳损 (RSI)** | [RSI Pattern](https://blog.fastthread.io/thread-dump-analysis-pattern-repetitive-strain-injury-rsi/) | 大量线程卡在完全相同调用栈的模式识别 |

> 💡 推荐先看 [Really Running](https://blog.fastthread.io/really-running/) 纠正常见误区，再阅读各检测模式文章深入理解分析原理。

---

## 功能预览

<details>
<summary>📸 点击展开功能截图</summary>

### 概览
![概览](docs/screenshots/cn/01-overview.png)

### 线程列表
![线程列表](docs/screenshots/cn/02-threads.png)

### 锁竞争图
![锁竞争图](docs/screenshots/cn/03-lock-graph.png)

### 死锁检测
![死锁检测](docs/screenshots/cn/04-deadlock.png)

### 火焰图
![火焰图](docs/screenshots/cn/05-flamegraph.png)

### CPU 推测
![CPU 推测](docs/screenshots/cn/06-cpu-inference.png)

### 精准 CPU 采集
![精准 CPU 采集](docs/screenshots/cn/07-cpu-precise.png)

</details>

---

## 许可

本项目基于 [Apache License 2.0](LICENSE) 开源。

> ⚠️ 使用前请务必阅读 [附加免责与使用声明](DISCLAIMER.md)。
