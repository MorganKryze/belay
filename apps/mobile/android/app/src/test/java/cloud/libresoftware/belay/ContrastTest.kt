package cloud.libresoftware.belay

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ContrastTest {
    @Test
    fun `a contrast of 0_25 is not increased`() = assertFalse(isHighContrast(0.25f, false))

    @Test
    fun `a contrast above 0_25 is increased`() = assertTrue(isHighContrast(0.26f, false))

    @Test
    fun `high contrast text counts at the default contrast`() = assertTrue(isHighContrast(0f, true))

    @Test
    fun `a negative contrast is not increased`() = assertFalse(isHighContrast(-1f, false))
}
