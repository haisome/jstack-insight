package com.zeng.jstackinsight.api.request;

/**
 * 上传请求入参 DTO
 *
 * <p>上传接口采用 {@code multipart/form-data} 形式，文件通过
 * {@code MultipartFile} 接收，本 DTO 仅承载可选的元数据字段。
 *
 * @author zeng
 */
public class UploadRequest {

    /**
     * 可选：文件描述（便于区分多次上传）
     */
    private String description;

    /**
     * 可选：来源环境标识（如 "prod"、"staging"）
     */
    private String environment;

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getEnvironment() {
        return environment;
    }

    public void setEnvironment(String environment) {
        this.environment = environment;
    }
}
