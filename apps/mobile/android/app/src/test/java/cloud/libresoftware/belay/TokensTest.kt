package cloud.libresoftware.belay

import java.security.ProviderException
import javax.crypto.AEADBadTagException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class TokensTest {
    private class MapStore : PrefsStore {
        val values = mutableMapOf<String, String>()

        override fun get(key: String): String? = values[key]

        override fun put(key: String, value: String?) {
            if (value == null) values.remove(key) else values[key] = value
        }

        // A commit the disk refuses changes nothing, as with the app's preferences file.
        var commitFails = false

        override fun putAll(values: Map<String, String?>) {
            if (commitFails) throw IllegalStateException("preferences not written")
            values.forEach { (key, value) -> put(key, value) }
        }
    }

    // Seals by XOR, so a test can tell a sealed value from the token. Opens only a value that starts
    // with SEALED: KEY_GONE fails as a Keystore that lost its key, BUSY as one that cannot answer
    // right now, an empty value as a too short one, anything else as a damaged value.
    private class XorCrypto : TokenCrypto {
        // Set to make the next seal fail, as a Keystore that cannot make or use its key would.
        var sealFails = false

        override fun seal(plain: ByteArray): ByteArray {
            if (sealFails) throw IllegalStateException("cannot seal")
            return byteArrayOf(SEALED) + plain.map { (it.toInt() xor 0x5a).toByte() }
        }

        override fun open(sealed: ByteArray): ByteArray {
            require(sealed.isNotEmpty()) { "too short" }
            when (sealed[0]) {
                SEALED -> return sealed.drop(1).map { (it.toInt() xor 0x5a).toByte() }.toByteArray()
                KEY_GONE -> throw TokenKeyGoneException()
                BUSY -> throw ProviderException("keystore busy")
                else -> throw AEADBadTagException("tag mismatch")
            }
        }

        companion object {
            const val SEALED: Byte = 1
            const val REFUSED: Byte = 2
            const val KEY_GONE: Byte = 3
            const val BUSY: Byte = 4
        }
    }

    private val store = MapStore()
    private val crypto = XorCrypto()
    private val vault = TokenVault(store, crypto)

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
    fun `a write that cannot seal keeps the previous session`() {
        vault.write("https://a.example", "token-a")
        crypto.sealFails = true
        assertThrows(IllegalStateException::class.java) { vault.write("https://b.example", "token-b") }
        assertEquals("token-a", vault.read("https://a.example"))
    }

    @Test
    fun `a write the disk refuses keeps the previous session`() {
        vault.write("https://a.example", "token-a")
        store.commitFails = true
        assertThrows(IllegalStateException::class.java) { vault.write("https://b.example", "token-b") }
        store.commitFails = false
        assertEquals("token-a", vault.read("https://a.example"))
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

    private fun seed(vararg sealed: Byte) {
        store.put("origin", "https://a.example")
        store.put("sealed", java.util.Base64.getEncoder().encodeToString(sealed))
    }

    @Test
    fun `a key that is gone reads none and erases`() {
        seed(XorCrypto.KEY_GONE, 9)
        assertNull(vault.read("https://a.example"))
        assertNull(store.get("sealed"))
    }

    @Test
    fun `a too short value reads none and erases`() {
        seed()
        assertNull(vault.read("https://a.example"))
        assertNull(store.get("sealed"))
    }

    @Test
    fun `a keystore that cannot answer now throws and keeps the session`() {
        seed(XorCrypto.BUSY, 9)
        assertThrows(ProviderException::class.java) { vault.read("https://a.example") }
        assertEquals("https://a.example", store.get("origin"))
        assertNotNull(store.get("sealed"))
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
