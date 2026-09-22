import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.intellij.platform) apply false
}

group = "com.codem"
version = "0.1.0"

val pluginTasks = setOf("runIde", "buildPlugin", "verifyPlugin", "prepareSandbox", "installAndReload")
val pluginRequested = gradle.startParameter.taskNames.any { name ->
    val simple = name.substringAfterLast(':')
    pluginTasks.any { task -> simple == task || simple.startsWith("${task}_") }
} || project.hasProperty("codem.plugin")

val repoRoot = rootProject.projectDir.parentFile.parentFile

repositories {
    mavenCentral()
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
        kotlin.setSrcDirs(buildList {
            add("src/main/kotlin")
            if (pluginRequested) add("src/plugin/kotlin")
        })
        resources.setSrcDirs(listOf("src/main/resources"))
    }
    test {
        kotlin.setSrcDirs(listOf("tests"))
        resources.setSrcDirs(listOf("tests/resources"))
    }
}

dependencies {
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform { excludeTags("nativeRuntime", "liveCore") }
    workingDir = repoRoot
    systemProperty("codem.contractsHistory", repoRoot.resolve("packages/contracts/history").path)
    testLogging {
        events("passed", "skipped", "failed")
    }
}

if (findProject(":host") != null) {
    tasks.register<Test>("liveTest") {
        group = "verification"
        description = "Explicit real-account/model test: send, close, restore history and continue in a temporary workspace."
        dependsOn(":host:stageRuntime", tasks.testClasses)
        testClassesDirs = sourceSets.test.get().output.classesDirs
        classpath = sourceSets.test.get().runtimeClasspath
        useJUnitPlatform { includeTags("liveCore") }
        systemProperty("codem.pluginRoot", layout.buildDirectory.dir("runtime").get().asFile.path)
        outputs.upToDateWhen { false }
        testLogging { events("passed", "failed", "standardOut") }
    }

    tasks.register<Test>("runtimeTest") {
        group = "verification"
        description = "Verify the packaged native binaries in an isolated directory, without login or model calls."
        dependsOn(":host:buildPlugin", tasks.testClasses)
        testClassesDirs = sourceSets.test.get().output.classesDirs
        classpath = sourceSets.test.get().runtimeClasspath
        useJUnitPlatform { includeTags("nativeRuntime") }
        systemProperty("codem.pluginZip", project(":host").layout.buildDirectory.file("distributions/host-${project.version}.zip").get().asFile.path)
        outputs.upToDateWhen { false }
        testLogging { events("passed", "failed", "standardOut") }
    }
}

tasks.register("domainTest") {
    group = "verification"
    description = "Domain tests that do not download the IntelliJ SDK."
    dependsOn(tasks.test)
}

tasks.register<Copy>("stageUi") {
    group = "build"
    from(repoRoot.resolve("packages/ui/dist")) {
        include("index.html", "browser.js", "styles.css")
    }
    into(layout.buildDirectory.dir("ui"))
}

tasks.register<Exec>("buildSharedUi") {
    group = "build"
    workingDir = repoRoot
    val pnpm = if (System.getProperty("os.name").lowercase().contains("win")) "pnpm.cmd" else "pnpm"
    commandLine(pnpm, "--filter", "@codem/ui", "build")
}

tasks.named("stageUi") {
    dependsOn("buildSharedUi")
}

tasks.named("check") {
    dependsOn("domainTest")
}

if (pluginRequested) {
    tasks.register("runIde") {
        group = "intellij platform"
        description = "Do not use on this machine: starts a second 2024.3.6 sandbox. Install the zip into the open 2026.2.3 instead."
        dependsOn(":host:runIde")
    }
    tasks.register("verifyPlugin") {
        group = "intellij platform"
        dependsOn(":host:verifyPlugin")
    }
    tasks.register("buildPlugin") {
        group = "build"
        dependsOn(":host:buildPlugin")
    }
    tasks.register<Exec>("installAndReload") {
        group = "intellij platform"
        description = "Install zip into the open 2026.2.3 and reload that same IU. Never runIde."
        dependsOn(":host:buildPlugin")
        workingDir = projectDir
        commandLine("node", "--experimental-strip-types", "scripts/installAndReload.ts", "--skip-build")
    }
} else {
    tasks.register("buildPlugin") {
        group = "build"
        doLast {
            throw GradleException(
                "CodeM plugin packaging needs the IntelliJ SDK. Run ./gradlew buildPlugin (or runIde) to download IDEA 2024.3.6; domainTest does not replace it.",
            )
        }
    }
}
