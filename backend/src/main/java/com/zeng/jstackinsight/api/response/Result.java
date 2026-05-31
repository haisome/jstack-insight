package com.zeng.jstackinsight.api.response;

import lombok.Data;

/**
 * 统一响应包装体
 *
 * <p>前端约定：
 * <pre>
 * {
 *   "code": 0,       // 0=成功，非0=失败
 *   "msg": "ok",
 *   "data": { ... }  // 业务数据
 * }
 * </pre>
 *
 * @param <T> 业务数据类型
 * @author zeng
 */
@Data
public class Result<T> {

    /** 业务状态码：0 表示成功 */
    private int code;

    /** 提示消息 */
    private String msg;

    /** 业务数据 */
    private T data;

    // ------------------- 工厂方法 -------------------

    public static <T> Result<T> ok(T data) {
        Result<T> r = new Result<>();
        r.code = 0;
        r.msg = "ok";
        r.data = data;
        return r;
    }

    public static <T> Result<T> fail(int code, String msg) {
        Result<T> r = new Result<>();
        r.code = code;
        r.msg = msg;
        return r;
    }

    public static <T> Result<T> fail(String msg) {
        return fail(500, msg);
    }
}
