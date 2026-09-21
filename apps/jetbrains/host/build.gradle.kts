import org.gradle.language.jvm.tasks.ProcessResources
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

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

tasks.named<JavaExec>("runIde") {
    args(repoRoot.absolutePath)
}
