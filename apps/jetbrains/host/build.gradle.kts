import org.gradle.language.jvm.tasks.ProcessResources
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.intellij.platform.gradle.tasks.PrepareSandboxTask

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.intellij.platform)
}

group = "com.codem"
version = "0.1.0"

val repoRoot = rootProject.projectDir.parentFile.parentFile
val ideaVersion = providers.gradleProperty("codem.ideaVersion").orElse("2024.3.6")

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
        allWarningsAsErrors.set(true)
    }
}

sourceSets {
    main {
        kotlin.setSrcDirs(listOf("../src/main/kotlin", "../src/plugin/kotlin"))
        resources.setSrcDirs(listOf("../src/main/resources"))
    }
}

dependencies {
    intellijPlatform {
        intellijIdeaCommunity(ideaVersion.get())
        // Optional at runtime (codem-terminal.xml): only the terminal command insertion uses it.
        bundledPlugin("org.jetbrains.plugins.terminal")
    }
}

intellijPlatform {
    buildSearchableOptions = false
    pluginConfiguration {
        // 编译仍用 2024.3.6；until-build 覆盖本机已开的 2026.2.3，避免再开 243 沙箱。
        ideaVersion {
            sinceBuild = "243"
            untilBuild = "262.*"
        }
    }
}

tasks.named<ProcessResources>("processResources") {
    dependsOn(":stageUi")
    from(rootProject.layout.buildDirectory.dir("ui")) {
        into("codem-ui")
    }
}

val stageRuntime by tasks.registering(Exec::class) {
    workingDir = rootProject.projectDir
    // Always validate the installed pinned packages before creating an archive.
    commandLine("node", "--experimental-strip-types", "scripts/stageRuntime.ts")
    inputs.file(rootProject.file("scripts/stageRuntime.ts"))
    inputs.file(repoRoot.resolve("pnpm-lock.yaml"))
    outputs.dir(rootProject.layout.buildDirectory.dir("runtime"))
    outputs.upToDateWhen { false }
}

tasks.withType<PrepareSandboxTask>().configureEach {
    dependsOn(stageRuntime)
    from(rootProject.layout.buildDirectory.dir("runtime")) {
        into(pluginName)
    }
    from(repoRoot.resolve("LICENSE")) {
        into(pluginName)
    }
}

tasks.named<JavaExec>("runIde") {
    args(repoRoot.absolutePath)
}
