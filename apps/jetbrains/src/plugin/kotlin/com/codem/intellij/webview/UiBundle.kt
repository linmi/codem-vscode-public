package com.codem.intellij.webview

import com.intellij.openapi.application.PathManager
import com.intellij.openapi.diagnostic.Logger
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption

/**
 * 把打包的 @codem/ui 白名单文件落到插件临时目录，并写入 IDE 主题色。
 * 只允许 index.html / browser.js / styles.css，不把路径写进界面。
 */
object UiBundle {
    private val log = Logger.getInstance(UiBundle::class.java)
    private val files = listOf("index.html", "browser.js", "styles.css")

    fun materialize(loader: ClassLoader, tokens: IdeTheme.Tokens = IdeTheme.current()): Path? {
        val index = loader.getResourceAsStream("codem-ui/index.html") ?: return null
        val dest = Path.of(PathManager.getTempPath(), "codem-ui")
        Files.createDirectories(dest)
        val html = index.use { it.readBytes().toString(StandardCharsets.UTF_8) }
        Files.writeString(dest.resolve("index.html"), IdeTheme.paintIndex(html, tokens), StandardCharsets.UTF_8)
        for (name in files.drop(1)) {
            loader.getResourceAsStream("codem-ui/$name")?.use { input ->
                Files.copy(input, dest.resolve(name), StandardCopyOption.REPLACE_EXISTING)
            }
        }
        if (!Files.isRegularFile(dest.resolve("browser.js")) || !Files.isRegularFile(dest.resolve("styles.css"))) {
            log.warn("CodeM UI bundle is incomplete")
            return null
        }
        log.info("CodeM UI bundle staged")
        return dest
    }
}
