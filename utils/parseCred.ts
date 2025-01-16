import { RegistrationResponseJSON } from "@simplewebauthn/typescript-types"
import { WebAuthnKey } from "@zerodev/webauthn-key"
import { keccak256 } from "viem"
import { fromBER, BitString } from "asn1js"
import { Buffer } from "buffer"

export const b64ToBytes = (base64: string): Uint8Array => {
    const paddedBase64 = base64
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=")
    const binString = atob(paddedBase64)
    return Uint8Array.from(binString, (m) => m.codePointAt(0) ?? 0)
}

export const uint8ArrayToHexString = (array: Uint8Array): `0x${string}` => {
    return `0x${Array.from(array, (byte) =>
        byte.toString(16).padStart(2, "0")
    ).join("")}` as `0x${string}`
}

/**
 * Parses a base64-encoded SPKI for P-256 ECDSA public key.
 * Extracts the uncompressed point (0x04 + 32-byte X + 32-byte Y) from the BIT STRING.
 * Then slices out (x, y) in hex.
 */
export function parseP256SpkiBase64(pubKeyB64: string) {
    // 1. Decode base64 -> Uint8Array
    const raw = Buffer.from(pubKeyB64, "base64")
    // Convert that into an ArrayBuffer needed by asn1js
    const rawArrayBuf = raw.buffer.slice(
        raw.byteOffset,
        raw.byteOffset + raw.byteLength
    )

    // 2. Parse the ASN.1
    const asn1 = fromBER(rawArrayBuf)
    if (asn1.offset === -1) {
        throw new Error("Failed to parse ASN.1 structure (offset = -1).")
    }

    // Typically SubjectPublicKeyInfo = SEQUENCE(2) => [0] AlgorithmIdentifier, [1] subjectPublicKey (BIT STRING)
    const spkiSequence = asn1.result
    if (!spkiSequence.valueBlock || spkiSequence.valueBlock.value.length < 2) {
        throw new Error("Not a valid SubjectPublicKeyInfo sequence.")
    }

    // The second element should be a BIT STRING representing the public key
    const subjectPublicKeyInfo = spkiSequence.valueBlock.value[1]
    if (!(subjectPublicKeyInfo instanceof BitString)) {
        throw new Error(
            "SPKI does not contain a BitString in the second element."
        )
    }

    // 3. The actual uncompressed key bytes are in subjectPublicKeyInfo.valueBlock.valueHex
    // This is an ArrayBuffer. Convert to Uint8Array for easy slicing.
    const pkBitString = new Uint8Array(subjectPublicKeyInfo.valueBlock.valueHex)

    /**
     * Some notes:
     * - Usually for an uncompressed ECDSA key on P-256, pkBitString starts with 0x04,
     *   followed by 32 bytes X, 32 bytes Y.
     * - asn1js automatically handles the "unused bits" in the BIT STRING, so we
     *   typically don't need to skip a byte with "unused bits" manually.
     */

    // If uncompressed, we expect exactly 65 bytes: 0x04 + 32 + 32
    if (pkBitString.length < 65) {
        throw new Error(
            `Public key bit string is too short. Length = ${pkBitString.length}`
        )
    }
    if (pkBitString[0] !== 0x04) {
        throw new Error(
            "Expected uncompressed format (0x04) at start of public key data."
        )
    }

    // 4. Extract X/Y
    const xBytes = pkBitString.slice(1, 33)
    const yBytes = pkBitString.slice(33, 65)

    const xHex = Buffer.from(xBytes).toString("hex")
    const yHex = Buffer.from(yBytes).toString("hex")

    return { xHex, yHex }
}

export const parseCred = async (
    cred: RegistrationResponseJSON
): Promise<WebAuthnKey> => {
    const authenticatorId = cred.id
    const authenticatorIdHash = keccak256(
        uint8ArrayToHexString(b64ToBytes(authenticatorId))
    )
    const pubKey = cred.response.publicKey

    if (!pubKey) {
        throw new Error("No public key found in response")
    }

    // pubKey = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEJRJO-ZH7C2sld2m14Qd9frXJXfs2e8KNXlpfwXNxHH9OaBMIK7S3r_TiNlIn05LoD6eU0WylGNIyMdFEy8xg5A"

    const { xHex, yHex } = parseP256SpkiBase64(pubKey)

    console.log("X coordinate:", xHex)
    console.log("Y coordinate:", yHex)

    return {
        pubX: BigInt(`0x${xHex}`),
        pubY: BigInt(`0x${yHex}`),
        authenticatorId,
        authenticatorIdHash
    }
}
