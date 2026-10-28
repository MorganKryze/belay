package cloud.libresoftware.belay

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import java.security.KeyStore
import java.util.Base64
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

// Encrypts and decrypts the token. Both throw when they cannot: a key that is gone, a value that
// was damaged or restored from elsewhere.
interface TokenCrypto {
    fun seal(plain: ByteArray): ByteArray

    fun open(sealed: ByteArray): ByteArray
}

// The Keystore no longer holds the key the token was sealed with: it is gone for good.
class TokenKeyGoneException : IllegalStateException("token key gone")

// One token at a time, bound to the instance origin it was written for: a new instance never
// inherits the old one's session, and another origin never reads it.
class TokenVault(private val store: PrefsStore, private val crypto: TokenCrypto) {
    fun read(origin: String): String? {
        val sealed = store.get(SEALED) ?: return null
        if (store.get(ORIGIN) != origin) return null
        val plain =
            try {
                crypto.open(Base64.getDecoder().decode(sealed))
            } catch (e: Exception) {
                // A token nobody can read again is worth nothing: erased, the page asks to sign in.
                // A Keystore that only fails now (busy, locked) throws, and the session stays.
                if (!unreadableForGood(e)) throw e
                clear()
                return null
            }
        return String(plain, Charsets.UTF_8)
    }

    // A value that was damaged or does not decode (bad base64, too short), or a key that is gone.
    private fun unreadableForGood(e: Exception) =
        e is AEADBadTagException || e is IllegalArgumentException || e is TokenKeyGoneException

    // Sealed before anything is erased: a Keystore that fails here leaves the previous session.
    fun write(origin: String, token: String) {
        val sealed = Base64.getEncoder().encodeToString(crypto.seal(token.toByteArray(Charsets.UTF_8)))
        clear()
        store.put(ORIGIN, origin)
        store.put(SEALED, sealed)
    }

    fun clear() {
        store.put(SEALED, null)
        store.put(ORIGIN, null)
    }

    private companion object {
        const val ORIGIN = "origin"
        const val SEALED = "sealed"
    }
}

// AES-256-GCM under a key that never leaves the Android Keystore (StrongBox when the phone has
// one). The 12-byte IV the Keystore picks goes in front of the ciphertext.
private class KeystoreCrypto : TokenCrypto {
    override fun seal(plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, existingKey() ?: newKey())
        return cipher.iv + cipher.doFinal(plain)
    }

    override fun open(sealed: ByteArray): ByteArray {
        require(sealed.size > IV_BYTES) { "sealed token too short" }
        // Never a new key here: one made now could not open what an older key sealed.
        val key = existingKey() ?: throw TokenKeyGoneException()
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, sealed, 0, IV_BYTES))
        return cipher.doFinal(sealed, IV_BYTES, sealed.size - IV_BYTES)
    }

    private fun existingKey(): SecretKey? {
        val keys = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        return keys.getKey(ALIAS, null) as SecretKey?
    }

    private fun newKey(): SecretKey =
        try {
            generate(strongBox = true)
        } catch (_: StrongBoxUnavailableException) {
            generate(strongBox = false)
        }

    private fun generate(strongBox: Boolean): SecretKey {
        val spec =
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setIsStrongBoxBacked(strongBox)
                .build()
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(spec)
        return generator.generateKey()
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "belay.session"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
        const val TAG_BITS = 128
    }
}

// The session token kept for the instance, in the app's private preferences, sealed by the Keystore.
// The page's calls arrive one at a time on the plugin's own thread, never on the main one.
class Tokens(private val context: Context) {
    private val vault by lazy { TokenVault(SharedPrefsStore(context, "belay.session"), KeystoreCrypto()) }

    fun read(call: PluginCall) {
        val origin = call.getString("origin") ?: return call.reject("origin missing")
        val token =
            try {
                vault.read(origin)
            } catch (e: Exception) {
                return call.reject("token read failed (${e.javaClass.simpleName})")
            }
        call.resolve(JSObject().put("token", token ?: JSONObject.NULL))
    }

    fun write(call: PluginCall) {
        val origin = call.getString("origin")
        val token = call.getString("token")
        if (origin == null || token == null) return call.reject("origin or token missing")
        try {
            vault.write(origin, token)
        } catch (e: Exception) {
            return call.reject("token write failed (${e.javaClass.simpleName})")
        }
        call.resolve()
    }

    fun clear(call: PluginCall) {
        try {
            vault.clear()
        } catch (e: Exception) {
            return call.reject("token delete failed (${e.javaClass.simpleName})")
        }
        call.resolve()
    }
}
