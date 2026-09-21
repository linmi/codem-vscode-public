package com.codem.intellij.account

/** 认证与空间的可替换端口，供 ProjectSession 测试注入，不依赖真实 CLI。 */
interface AuthGateway {
    fun status(): AuthStatus
    fun assertAuthenticated(status: AuthStatus)
}

interface SpaceGateway {
    fun prepareInitial(requestedKey: String? = null): SpacePreparation
    fun prepare(projectKey: String): PreparedSpace
    fun launchArguments(space: PreparedSpace): Pair<List<String>, Map<String, String>>
}
