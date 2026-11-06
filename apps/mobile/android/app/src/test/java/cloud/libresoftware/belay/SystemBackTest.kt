package cloud.libresoftware.belay

import org.junit.Assert.assertEquals
import org.junit.Test

class SystemBackTest {
    @Test
    fun `a step the page took is done`() {
        for (top in listOf("surface", "cover", "page", "tab-root")) {
            assertEquals(Answer.DONE, BackAnswer.of("\"$top\""))
        }
    }

    @Test
    fun `Accueil's root lets the app step aside`() {
        assertEquals(Answer.LEAVE, BackAnswer.of("\"home\""))
    }

    @Test
    fun `anything else is silence`() {
        for (raw in listOf(null, "null", "", "1", "true", "\"elsewhere\"", "home", "\"HOME\"", "{}")) {
            assertEquals(Answer.SILENT, BackAnswer.of(raw))
        }
    }

    @Test
    fun `the page has half a second to answer`() {
        assertEquals(500L, ANSWER_MS)
    }
}
