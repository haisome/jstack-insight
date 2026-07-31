package com.zeng.jstackinsight.aspect;

import org.slf4j.MDC;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import javax.servlet.*;
import javax.servlet.http.HttpServletRequest;
import java.io.IOException;

/**
 * 将客户端 IP 注入 MDC，使所有日志自动携带 IP 信息。
 *
 * <p>配合 logging.pattern.console 中的 %X{clientIp} 使用。
 *
 * @author zeng
 */
@Component
@Order(1)
public class IpLogFilter implements Filter {

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        String ip = getClientIp((HttpServletRequest) request);
        MDC.put("clientIp", ip);
        try {
            chain.doFilter(request, response);
        } finally {
            MDC.remove("clientIp");
        }
    }

    /**
     * 获取客户端真实 IP，考虑代理/负载均衡场景。
     */
    static String getClientIp(HttpServletRequest request) {
        String ip = request.getHeader("X-Forwarded-For");
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("X-Real-IP");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("Proxy-Client-IP");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getRemoteAddr();
        }
        // X-Forwarded-For 可能包含多个 IP，取第一个
        if (ip != null && ip.contains(",")) {
            ip = ip.split(",")[0].trim();
        }
        return ip;
    }
}
