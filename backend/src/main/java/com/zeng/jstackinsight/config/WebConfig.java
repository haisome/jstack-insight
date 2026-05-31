package com.zeng.jstackinsight.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Web 及 Swagger 配置
 *
 * @author zeng
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    /**
     * 全局跨域配置（开发阶段）
     */
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns("*")
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .maxAge(3600);
    }

    /**
     * OpenAPI 3.0 文档配置
     */
    @Bean
    public OpenAPI jstackInsightOpenAPI() {
        return new OpenAPI()
                .info(new Info()
                        .title("JStack Insight API")
                        .description("企业级 JVM 线程转储（jstack）分析平台 - 对标 fastthread.io")
                        .version("1.0.0")
                        .contact(new Contact()
                                .name("zeng")
                                .email("zeng@example.com"))
                        .license(new License()
                                .name("Apache 2.0")
                                .url("https://www.apache.org/licenses/LICENSE-2.0")));
    }
}
