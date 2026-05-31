import axios from 'axios';
import type { ApiResult, AnalysisResultVO, TopCpuVO } from '../types';

/**
 * Axios 实例配置
 */
const http = axios.create({
  baseURL: process.env.REACT_APP_API_BASE_URL || 'http://localhost:8080',
  timeout: 60000,
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
 * 上传并分析 jstack 文件
 */
export async function uploadAndAnalyze(file: File): Promise<AnalysisResultVO> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await http.post<ApiResult<AnalysisResultVO>>(
    '/api/v1/analysis/upload',
    formData,
    {
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
 * 上传 top -H 文件关联 CPU 分析
 * 需要同时上传 jstack 和 top 文件
 */
export async function uploadTopForCpu(
  jstackFile: File,
  topFile: File
): Promise<TopCpuVO> {
  const formData = new FormData();
  formData.append('jstackFile', jstackFile);
  formData.append('topFile', topFile);

  const response = await http.post<ApiResult<TopCpuVO>>(
    '/api/v1/analysis/top-cpu',
    formData
  );

  return response.data.data;
}
