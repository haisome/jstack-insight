# JStack Insight

> 企业级 JVM 线程转储（jstack）可视化分析平台

[![JDK](https://img.shields.io/badge/JDK-1.8%2B-blue)](https://adoptium.net)
[![Spring Boot](https://img.shields.io/badge/Spring%20Boot-2.7.18-brightgreen)](https://spring.io/projects/spring-boot)
[![React](https://img.shields.io/badge/React-18.3.1-61dafb)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.9.5-3178c6)](https://www.typescriptlang.org)

---

## 简介

**JStack Insight** 是一个面向 Java 开发者和 SRE 的 jstack 线程转储分析工具。上传 `jstack` 输出的文本文件，即可获得线程状态分布、锁竞争图、火焰图、死锁检测等多维度分析结果，帮助快速定位线上 CPU 飙升、线程死锁、线程池堆积等性能问题。

设计灵感来源于 [fastthread.io](https://fastthread.io)。

---

## 核心功能

| 模块 | 说明 |
|------|------|
| **线程状态概览** | 饼图 + 指标卡展示线程状态分布（RUNNABLE / BLOCKED / WAITING 等） |
| **线程列表** | 可按名称、状态搜索过滤，展开查看完整调用栈 |
| **线程组分析** | 按线程名前缀自动分组，展示各组内状态分布 |
| **相同堆栈分析** | 按调用栈内容分组，快速发现大量同栈线程（死循环 / 线程池堆积） |
| **锁竞争图** | D3.js 力导向图展示线程 <-> 锁的持有 / 等待关系 |
| **死锁检测** | 基于 DFS 三色标记算法检测 Monitor 锁与 JUC 锁的环路依赖 |
| **火焰图** | D3 Partition Ice Chart 聚合展示调用栈热点 |
| **CPU 分析** | 启发式 CPU 线程推测 + 上传 `top -H` 进行精准 CPU 关联 |
| **中英文切换** | 内置 i18n，一键切换中文 / English |

---

## 技术栈

### 后端

- **JDK 1.8**
- **Spring Boot 2.7.18**
- **Maven** 构建
- **Lombok**、**Apache Commons Lang3**
- **SpringDoc OpenAPI 3**（Swagger UI 自动文档）

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
├── sample_jstack.txt                 # 示例 jstack 文件
│
├── backend/                          # Spring Boot 后端
│   ├── pom.xml
│   └── src/main/
│       ├── resources/
│       │   ├── application.yml       # 端口 9595，上传限制 50MB
│       │   └── static/              # 生产构建后前端静态文件
│       └── java/com/zeng/jstackinsight/
│           ├── controller/           # REST API
│           ├── service/
│           │   ├── parser/           # FSM 手写 jstack 解析器
│           │   └── analyzer/         # 死锁检测 + 火焰图构建
│           ├── api/                  # DTO / VO
│           └── exception/           # 全局异常处理
│
└── frontend/                         # React 前端
    ├── package.json                  # proxy -> localhost:9595
    ├── scripts/build-prod.js         # 构建并复制到 backend/static
    └── src/
        ├── pages/
        │   ├── upload/               # 上传页
        │   └── result/               # 结果页（概览/线程/锁图/火焰图/死锁/CPU）
        ├── types/                    # TypeScript 类型定义
        ├── services/                 # Axios HTTP 客户端
        └── i18n/                     # 中/英文翻译
```

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

浏览器打开 http://localhost:3000，上传 `sample_jstack.txt` 即可体验。

### 生产构建

```bash
# 构建前端（直接输出到后端 static 目录）
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

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/analysis/upload` | 上传 jstack 文件，执行全量分析 |
| POST | `/api/v1/analysis/top-cpu` | 上传 jstack + top -H 文件，执行精准 CPU 分析 |
| GET | `/api/v1/analysis/health` | 健康检查 |

上传分析接口返回包含线程状态、锁图、火焰图、死锁检测、CPU 推测等完整分析数据。

启动后访问 http://localhost:9595/swagger-ui/index.html 查看 Swagger 文档。

---

## 配置

### 后端 (`application.yml`)

```yaml
server:
  port: 9595

spring:
  servlet:
    multipart:
      max-file-size: 50MB
      max-request-size: 50MB
```

### 前端

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `REACT_APP_API_BASE_URL` | API 基地址 | `http://localhost:9595` |

---

## 代码仓库

[![GitHub](https://img.shields.io/badge/GitHub-haisome%2Fjstack--insight-181717?style=flat-square&logo=github)](https://github.com/haisome/jstack-insight)
[![Gitee](https://img.shields.io/badge/Gitee-Z--HaiSome%2Fjstack--insight-c71d23?style=flat-square&logo=gitee)](https://gitee.com/Z-HaiSome/jstack-insight)

---

## 参考资源

本项目的线程检测与分析模式参考自 [fastthread.io](https://fastthread.io) 专业博客，以下为核心参考文章：

| 主题 | 链接 | 说明 |
|------|------|------|
| **死锁检测** | [Deadlock](https://blog.fastthread.io/deadlock/) | Monitor 锁与 JUC 锁的环路依赖检测原理 |
| **循环等待死锁** | [Circular Deadlock](https://blog.fastthread.io/circular-deadlock/) | A→B→C→A 型循环死锁模式的识别与分析 |
| **Finalizer 陷阱** | [Leprechaun Trap](https://blog.fastthread.io/thread-dump-analysis-pattern-leprechaun-trap/) | Finalizer 线程卡在 finalize() 中导致 OOM 的检测模式 |
| **异常线程检测** | [Throwing Exception](https://blog.fastthread.io/threads-throwing-exception/) | 通过栈帧中的 Exception/Error 构造方法识别异常线程 |
| **RUNNABLE ≠ 运行中** | [Really Running](https://blog.fastthread.io/really-running/) | RUNNABLE 状态线程未必真正占用 CPU，需结合 top -H 交叉验证 |
| **重复性劳损 (RSI)** | [RSI Pattern](https://blog.fastthread.io/thread-dump-analysis-pattern-repetitive-strain-injury-rsi/) | 大量线程卡在完全相同调用栈的模式识别 |

> 💡 **推荐阅读顺序**：先了解 [Really Running](https://blog.fastthread.io/really-running/) 纠正常见误区，再阅读各检测模式文章深入理解分析原理。

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

> ⚠️ 使用前请务必阅读 [附加免责与使用声明](DISCLAIMER.md)，了解关于专利、隐私、推广限制及"按原样"提供的法律条款。
