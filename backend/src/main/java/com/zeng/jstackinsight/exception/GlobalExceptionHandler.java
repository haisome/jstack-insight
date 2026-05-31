package com.zeng.jstackinsight.exception;

import com.zeng.jstackinsight.api.response.Result;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

/**
 * 全局异常处理器
 *
 * <p>捕获 Controller 层抛出的未处理异常，统一包装为 {@link Result} 响应。
 *
 * @author zeng
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /**
     * 处理文件超出大小限制的异常
     */
    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public Result<Void> handleMaxUploadSizeExceeded(MaxUploadSizeExceededException ex) {
        log.warn("文件超出大小限制: {}", ex.getMessage());
        return Result.fail(413, "文件大小超出限制（最大 50MB）");
    }

    /**
     * 处理参数校验异常
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public Result<Void> handleIllegalArgument(IllegalArgumentException ex) {
        log.warn("参数校验失败: {}", ex.getMessage());
        return Result.fail(400, ex.getMessage());
    }

    /**
     * 处理未预期的运行时异常
     */
    @ExceptionHandler(Exception.class)
    public Result<Void> handleGeneral(Exception ex) {
        log.error("服务器内部错误", ex);
        return Result.fail(500, "服务器内部错误，请查看日志");
    }
}
