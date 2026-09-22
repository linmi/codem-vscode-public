pluginManagement {
    repositories {
        mavenCentral()
        gradlePluginPortal()
    }
}

rootProject.name = "codem-jetbrains"

val pluginTasks = setOf("runIde", "buildPlugin", "verifyPlugin", "prepareSandbox", "installAndReload", "runtimeTest", "liveTest")
val wantsPlugin = startParameter.taskNames.any { name ->
    val simple = name.substringAfterLast(':')
    name.contains(":host") || pluginTasks.any { task -> simple == task || simple.startsWith("${task}_") }
} || startParameter.projectProperties.containsKey("codem.plugin")

if (wantsPlugin) {
    include("host")
}
