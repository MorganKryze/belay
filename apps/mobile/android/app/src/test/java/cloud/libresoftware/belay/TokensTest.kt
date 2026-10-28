package cloud.libresoftware.belay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TokensTest {
    private class MapStore : PrefsStore {
        val values = mutableMapOf<String, String>()

        override fun get(key: String): String? = values[key]

        override fun put(key: String, value: String?) {
            if (value == null) values.remove(key) else values[key] = value
        }
    }

    // Seals by XOR, so a test can tell a sealed value from the token; refuses anything that starts
    // with REFUSED, as a key that is gone or a damaged value would.
    private class XorCrypto : TokenCrypto {
        override fun seal(plain: ByteArray) = byteArrayOf(SEALED) + plain.map { (it.toInt() xor 0x5a).toByte() }

        override fun open(sealed: ByteArray): ByteArray {
            if (sealed.isEmpty() || sealed[0] != SEALED) throw IllegalStateException("cannot open")
            return sealed.drop(1).map { (it.toInt() xor 0x5a).toByte() }.toByteArray()
        }

        companion object {
            const val SEALED: Byte = 1
            const val REFUSED: Byte = 2
        }
    }

    private val store = MapStore()
    private val vault = TokenVault(store, XorCrypto())

    @Test
    fun `reads the token for its origin`() {
        vault.write("https://a.example", "token-a")
        assertEquals("token-a", vault.read("https://a.example"))
        assertEquals(false, store.values.values.any { it.contains("token-a") })
    }

    @Test
    fun `other origin reads none`() {
        vault.write("https://a.example", "token-a")
        assertNull(vault.read("https://b.example"))
        assertEquals("token-a", vault.read("https://a.example"))
    }

    @Test
    fun `one token at a time`() {
        vault.write("https://a.example", "token-a")
        vault.write("https://b.example", "token-b")
        assertNull(vault.read("https://a.example"))
        assertEquals("token-b", vault.read("https://b.example"))
    }

    @Test
    fun `clear erases`() {
        vault.write("https://a.example", "token-a")
        vault.clear()
        assertNull(vault.read("https://a.example"))
        assertNull(store.get("origin"))
        assertNull(store.get("sealed"))
    }

    @Test
    fun `undecryptable reads none and erases`() {
        store.put("origin", "https://a.example")
        store.put("sealed", java.util.Base64.getEncoder().encodeToString(byteArrayOf(XorCrypto.REFUSED, 9, 9)))
        assertNull(vault.read("https://a.example"))
        assertNull(store.get("origin"))
        assertNull(store.get("sealed"))
    }

    @Test
    fun `damaged base64 reads none and erases`() {
        store.put("origin", "https://a.example")
        store.put("sealed", "not base64 at all!")
        assertNull(vault.read("https://a.example"))
        assertNull(store.get("origin"))
        assertNull(store.get("sealed"))
    }
}
