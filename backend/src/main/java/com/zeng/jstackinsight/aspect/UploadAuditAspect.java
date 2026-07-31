package com.zeng.jstackinsight.aspect;

import com.zeng.jstackinsight.api.response.Result;
import com.zeng.jstackinsight.service.impl.ReportService;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.multipart.MultipartFile;

import javax.servlet.http.HttpServletRequest;

/**
 * 上传审计切面。
 *
 * <p>拦截所有文件上传接口（jstack 分析、top CPU 关联），
 * 记录请求 IP、文件名、大小、处理耗时、UUID 等信息。
 * 后续可扩展为数据入库或监控告警。
 *
 * @author zeng
 */
@Aspect
@Component
public class UploadAuditAspect {

    private static final Logger log = LoggerFactory.getLogger("UPLOAD_AUDIT");

    /**
     * 拦截 AnalysisController 中所有 consume MULTIPART_FORM_DATA 的 POST 方法。
     */
    @Around("execution(* com.zeng.jstackinsight.controller.AnalysisController.*(..)) " +
            "&& @annotation(org.springframework.web.bind.annotation.PostMapping)")
    public Object audit(ProceedingJoinPoint joinPoint) throws Throwable {
        long start = System.currentTimeMillis();
        String ip = "unknown";
        String filename = "unknown";
        long fileSize = 0;

        try {
            ServletRequestAttributes attrs =
                    (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
            if (attrs != null) {
                HttpServletRequest req = attrs.getRequest();
                ip = IpLogFilter.getClientIp(req);
            }

            // 提取第一个 MultipartFile 参数的信息
            for (Object arg : joinPoint.getArgs()) {
                if (arg instanceof MultipartFile) {
                    MultipartFile f = (MultipartFile) arg;
                    filename = f.getOriginalFilename() != null ? f.getOriginalFilename() : "unknown";
                    fileSize = f.getSize();
                    break;
                }
            }

            String method = joinPoint.getSignature().getName();
            log.info("[开始] 方法={}, IP={}, 文件={}, 大小={}",
                    method, ip, filename, formatSize(fileSize));

            Object result = joinPoint.proceed();

            long duration = System.currentTimeMillis() - start;

            // 提取返回结果中的 UUID（仅 upload 方法返回 ReportSummaryVO）
            String uuid = "";
            String shareInfo = "";
            if (result instanceof Result) {
                Object data = ((Result<?>) result).getData();
                if (data instanceof ReportService.ReportSummaryVO) {
                    ReportService.ReportSummaryVO summary = (ReportService.ReportSummaryVO) data;
                    uuid = summary.getUuid();
                    shareInfo = ", 线程数=" + summary.getTotalThreads()
                            + ", 死锁=" + summary.isHasDeadlock();
                }
            }

            log.info("[完成] 方法={}, IP={}, 文件={}, 大小={}, uuid={}, 耗时={}ms{}",
                    method, ip, filename, formatSize(fileSize), uuid, duration, shareInfo);

            return result;

        } catch (Throwable e) {
            long duration = System.currentTimeMillis() - start;
            log.warn("[失败] 方法={}, IP={}, 文件={}, 大小={}, 耗时={}ms, 异常={}",
                    joinPoint.getSignature().getName(), ip, filename,
                    formatSize(fileSize), duration, e.getMessage());
            throw e;
        }
    }

    private static String formatSize(long bytes) {
        if (bytes <= 0) return "0B";
        if (bytes < 1024) return bytes + "B";
        if (bytes < 1024 * 1024) return String.format("%.1fKB", bytes / 1024.0);
        return String.format("%.1fMB", bytes / (1024.0 * 1024));
    }
}
