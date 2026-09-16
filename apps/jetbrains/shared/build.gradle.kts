plugins {
    alias(libs.plugins.rpc)
    alias(libs.plugins.kotlin)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    jvmToolchain(21)
}

dependencies {
    intellijPlatform {
        intellijIdea(libs.versions.intellij.platform)
    }

    testImplementation(kotlin("test"))
}

sourceSets.test {
    kotlin.setSrcDirs(listOf("../tests/shared/kotlin"))
    java.setSrcDirs(emptyList<String>())
    resources.setSrcDirs(listOf("../tests/shared/resources"))
}

tasks.test {
    useJUnitPlatform()
}
