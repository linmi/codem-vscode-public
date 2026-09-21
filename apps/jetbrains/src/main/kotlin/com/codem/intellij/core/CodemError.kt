package com.codem.intellij.core

/**
 * 按方案区分协议、认证、取消、业务冲突、结果不明和进程退出。
 * 不把销毁进程记为成功，也不用统一 catch 继续运行。
 */
sealed class CodemError(
    val errorClass: Class,
    message: String,
    cause: Throwable? = null,
    val operationId: String? = null,
    val stage: String? = null,
) : RuntimeException(message, cause) {
    enum class Class {
        InvalidJson,
        InvalidFrame,
        InvalidMethodFrame,
        UncorrelatedResponse,
        UnknownRequestId,
        UnknownNotification,
        StdinNotWritable,
        ConnectionClosed,
        Protocol,
        Authentication,
        Cancelled,
        Conflict,
        Indeterminate,
        ProcessExit,
        Capability,
        History,
        Validation,
    }

    class Protocol(
        errorClass: Class,
        message: String,
        cause: Throwable? = null,
        operationId: String? = null,
        stage: String? = null,
    ) : CodemError(errorClass, message, cause, operationId, stage)

    class Authentication(message: String, cause: Throwable? = null, operationId: String? = null) :
        CodemError(Class.Authentication, message, cause, operationId, "auth")

    class Cancelled(message: String = "CodeM operation was cancelled", operationId: String? = null) :
        CodemError(Class.Cancelled, message, operationId = operationId)

    class Conflict(message: String, operationId: String? = null, stage: String? = null) :
        CodemError(Class.Conflict, message, operationId = operationId, stage = stage)

    class Indeterminate(message: String, operationId: String? = null, stage: String? = null) :
        CodemError(Class.Indeterminate, message, operationId = operationId, stage = stage)

    class Process(message: String, cause: Throwable? = null, stage: String? = null) :
        CodemError(Class.ProcessExit, message, cause, stage = stage)

    class History(message: String) : CodemError(Class.History, message, stage = "history")

    class Validation(message: String) : CodemError(Class.Validation, message)
}
