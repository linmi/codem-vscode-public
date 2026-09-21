package com.codem.intellij.ide

import com.codem.intellij.core.CodemError
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path

class WorkspaceTrustTest {
    @Test
    fun untrustedFactsRejectDangerousOperations(@TempDir root: Path) {
        assertEquals(
            false,
            WorkspaceTrustPolicy.decide(
                WorkspaceTrustFacts(projectOpen = true, projectPath = root, candidatePath = root, ideReportsTrusted = false),
            ),
        )
        assertEquals(
            false,
            WorkspaceTrustPolicy.decide(
                WorkspaceTrustFacts(projectOpen = false, projectPath = root, candidatePath = root, ideReportsTrusted = true),
            ),
        )
        var failed = false
        try {
            WorkspaceTrustPolicy.requireTrusted(false, WorkspaceTrustPolicy.START_CORE)
        } catch (error: CodemError) {
            failed = error.errorClass == CodemError.Class.Validation
        }
        assertTrue(failed)
    }

    /** 宿主读不出信任结论时不得放行：null 与 false 同样拒绝。 */
    @Test
    fun unknownIdeTrustIsNotTrusted(@TempDir root: Path) {
        assertEquals(
            false,
            WorkspaceTrustPolicy.decide(
                WorkspaceTrustFacts(projectOpen = true, projectPath = root, candidatePath = root, ideReportsTrusted = null),
            ),
        )
        assertTrue(
            WorkspaceTrustPolicy.decide(
                WorkspaceTrustFacts(projectOpen = true, projectPath = root, candidatePath = root, ideReportsTrusted = true),
            ),
        )
    }

    @Test
    fun trustedProjectAllowsInRootAndRejectsEscape(@TempDir root: Path) {
        val inside = root.resolve("src")
        Files.createDirectory(inside)
        assertTrue(
            WorkspaceTrustPolicy.decide(
                WorkspaceTrustFacts(projectOpen = true, projectPath = root, candidatePath = inside, ideReportsTrusted = true),
            ),
        )
        assertEquals(
            false,
            WorkspaceTrustPolicy.decide(
                WorkspaceTrustFacts(
                    projectOpen = true,
                    projectPath = root,
                    candidatePath = root.parent.resolve("other"),
                    ideReportsTrusted = true,
                ),
            ),
        )
    }

    @Test
    fun pathGuardFollowsSymlinksOutOfRoot(@TempDir root: Path) {
        val outside = Files.createTempDirectory("codem-untrusted")
        val link = root.resolve("escape")
        Files.createSymbolicLink(link, outside)
        var failed = false
        try {
            PathGuard.bind(root, link.resolve("secret.txt"))
        } catch (error: CodemError) {
            failed = error.errorClass == CodemError.Class.Validation
        }
        assertTrue(failed)
        val inside = Files.createFile(root.resolve("ok.txt"))
        assertEquals(inside.toRealPath(), PathGuard.bind(root, inside))
    }
}
