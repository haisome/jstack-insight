package com.zeng.jstackinsight.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * SPA（单页应用）路由兜底控制器。
 *
 * <p>前端使用 BrowserRouter，路由 {@code /report/{uuid}} 只存在于浏览器端，
 * 后端没有对应的 Controller。若缺少兜底，直接访问或刷新该地址会返回 404。
 *
 * <p>这里把前端路由入口统一转发到 {@code /index.html}，由 React Router 接管后续渲染。
 *
 * <p>注意：
 * <ul>
 *   <li>Spring Boot 的欢迎页本身就是把 {@code /} forward 到 {@code /index.html}，
 *       因此这里<b>不能</b>再映射 {@code /index.html}，否则会形成 {@code / -> /index.html -> /} 死循环；
 *       {@code /index.html} 这种路径交给前端兜底路由重定向到 {@code /} 处理。</li>
 *   <li>所有后端接口都在 {@code /api/**}、{@code /v3/**}、{@code /swagger-ui**} 之下，
 *       与前端路由无重叠，不会被此兜底拦截。</li>
 * </ul>
 *
 * @author zeng
 */
@Controller
public class SpaForwardController {

    /**
     * 报告详情页：直接访问 / 刷新 /report/{uuid} 时转发到首页 HTML。
     */
    @GetMapping("/report/**")
    public String forwardReportPage() {
        return "forward:/index.html";
    }
}
