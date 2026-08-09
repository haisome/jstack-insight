import axios from 'axios';
import type {
  ApiResult,
  TopCpuVO,
  ReportSummary,
  ThreadStateVO,
  LockGraphVO,
  FlameGraphVO,
  DeadlockChainVO,
  ThreadSummary,
  StackGroupVO,
} from '../types';

/**
 * Axios 实例配置
 */
const http = axios.create({
  baseURL: process.env.REACT_APP_API_BASE_URL || 'http://localhost:9595',
  timeout: 30000, // 缩短超时为 30s，因为不再传输全量数据
});

// 响应拦截器：统一处理业务错误码
http.interceptors.response.use(
  (response) => {
    const res: ApiResult<unknown> = response.data;
    if (res.code !== 0) {
      return Promise.reject(new Error(res.msg || '请求失败'));
    }
    return response;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * 上传并分析 jstack 文件（返回报告 UUID + 摘要）。
 * 前端收到 uuid 后跳转到 /report/{uuid}，各模块数据按需加载。
 */
export async function uploadAndAnalyze(file: File): Promise<ReportSummary> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await http.post<ApiResult<ReportSummary>>(
    '/api/v1/analysis/upload',
    formData,
    {
      timeout: 120000,
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          console.debug(`上传进度: ${percent}%`);
        }
      },
    }
  );

  return response.data.data;
}

/**
 * 基于报告 UUID 上传 top 文件进行精准 CPU 关联。
 */
export async function uploadTopForCpuByReport(
  uuid: string,
  topFile: File
): Promise<TopCpuVO> {
  const formData = new FormData();
  formData.append('topFile', topFile);

  const response = await http.post<ApiResult<TopCpuVO>>(
    `/api/v1/analysis/top-cpu-with-report/${uuid}`,
    formData
  );

  return response.data.data;
}

// ================================================================
// 报告按需加载 API
// ================================================================

/**
 * 获取报告摘要（首屏展示，~200B）。
 */
export async function getReportSummary(uuid: string): Promise<ReportSummary> {
  const response = await http.get<ApiResult<ReportSummary>>(
    `/api/v1/report/${uuid}/summary`
  );
  return response.data.data;
}

/**
 * 获取线程状态汇总（不含调用栈，轻量）。
 */
export async function getThreadsSummary(uuid: string): Promise<ThreadStateVO> {
  const response = await http.get<ApiResult<ThreadStateVO>>(
    `/api/v1/report/${uuid}/threads-summary`
  );
  return response.data.data;
}

/**
 * 分页获取线程列表（不含调用栈）。
 */
export async function getThreadsPaged(
  uuid: string,
  page: number,
  size: number = 50
): Promise<ThreadStateVO> {
  const response = await http.get<ApiResult<ThreadStateVO>>(
    `/api/v1/report/${uuid}/threads`,
    { params: { page, size } }
  );
  return response.data.data;
}

/**
 * 获取线程分桶索引。
 */
export async function getThreadsIdx(
  uuid: string
): Promise<Record<number, number>> {
  const response = await http.get<ApiResult<Record<number, number>>>(
    `/api/v1/report/${uuid}/threads-idx`
  );
  return response.data.data;
}

/**
 * 获取一个线程分桶（~50 条完整详情，含调用栈）。
 */
export async function getThreadsBucket(
  uuid: string,
  bucket: number
): Promise<ThreadSummary[]> {
  const response = await http.get<ApiResult<ThreadSummary[]>>(
    `/api/v1/report/${uuid}/thread-bucket/${bucket}`
  );
  return response.data.data;
}

/**
 * 获取锁竞争图数据。
 */
export async function getReportLockGraph(uuid: string): Promise<LockGraphVO> {
  const response = await http.get<ApiResult<LockGraphVO>>(
    `/api/v1/report/${uuid}/lock-graph`
  );
  return response.data.data;
}

/**
 * 获取火焰图数据。
 */
export async function getReportFlameGraph(uuid: string): Promise<FlameGraphVO> {
  const response = await http.get<ApiResult<FlameGraphVO>>(
    `/api/v1/report/${uuid}/flame-graph`
  );
  return response.data.data;
}

/**
 * 获取死锁链路详情。
 */
export async function getReportDeadlocks(
  uuid: string
): Promise<DeadlockChainVO> {
  const response = await http.get<ApiResult<DeadlockChainVO>>(
    `/api/v1/report/${uuid}/deadlocks`
  );
  return response.data.data;
}

/**
 * 相同堆栈分组（预计算，轻量返回 ~50KB）。
 */
export async function getReportStackGroups(
  uuid: string
): Promise<StackGroupVO[]> {
  const response = await http.get<ApiResult<StackGroupVO[]>>(
    `/api/v1/report/${uuid}/stack-groups`
  );
  return response.data.data;
}

/**
 * 延长报告有效期至 5 天。
 */
export async function extendReport(uuid: string): Promise<number> {
  const response = await http.post<ApiResult<number>>(
    `/api/v1/report/${uuid}/extend`
  );
  return response.data.data;
}

/**
 * 导出静态 HTML 报告。
 */
export function getExportHtmlUrl(uuid: string): string {
  return `${http.defaults.baseURL}/api/v1/report/${uuid}/export-html`;
}
