plugins {
    `kotlin-dsl`
}

repositories {
    mavenCentral()
}

dependencies {
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.commons.compress)
    testImplementation(kotlin("test"))
}

sourceSets.test {
    kotlin.setSrcDirs(listOf("../tests/build-tasks/kotlin"))
    java.setSrcDirs(emptyList<String>())
    resources.setSrcDirs(listOf("../tests/build-tasks/resources"))
}

tasks.test {
    useJUnitPlatform()
}

gradlePlugin {
    plugins {
        create("build-tasks") {
            id = "build-tasks"
            implementationClass = "BuildTasksPlugin"
        }
    }
}
