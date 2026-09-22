package com.codem.intellij.ide

import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.isDirectory
import kotlin.io.path.isRegularFile

/**
 * `@` 提及用的工作区文件搜索。只返回相对路径，调用方再换成不透明句柄。
 * 跳过依赖和构建目录，深度和条数都有上限。
 */
object WorkspaceFileSearch {
    private val skipped = setOf(".git", "node_modules", "build", "dist", "out", ".idea", ".gradle")

    fun search(root: Path, query: String, limit: Int = 20): List<String> {
        if (!Files.isDirectory(root) || limit !in 1..50) return emptyList()
        val needle = query.trim().lowercase()
        val matches = mutableListOf<String>()
        Files.walk(root, 6).use { stream ->
            stream.filter { path ->
                path.isRegularFile() && path.none { it.toString() in skipped }
            }.forEach { path ->
                if (matches.size >= limit) return@forEach
                val relative = root.relativize(path).toString().replace('\\', '/')
                if (needle.isEmpty() || relative.lowercase().contains(needle)) matches += relative
            }
        }
        return matches
    }
}
