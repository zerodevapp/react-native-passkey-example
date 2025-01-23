import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { cors } from "hono/cors"
import cbor from "cbor"
import {
    generateRegistrationOptions,
    generateAuthenticationOptions,
    verifyRegistrationResponse,
    verifyAuthenticationResponse
} from "@simplewebauthn/server"
import type {
    RegistrationResponseJSON,
    AuthenticationResponseJSON
} from "@simplewebauthn/typescript-types"
import { v4 as uuidv4 } from "uuid"

interface UserRecord {
    username: string
    credentials: {
        credentialID: string // base64url
        publicKey: string // base64url
        counter: number
    }
}

/**
 * We'll store the user records in a Map keyed by userId.
 * In real production code, store them in a DB (SQL/NoSQL).
 */
const userDB = new Map<string, UserRecord>()

/**
 * For registration, store the userId keyed by challenge
 */
const registrationChallengeMap = new Map<string, string>()

/**
 * For login, store just the fact that a challenge is valid.
 * We don't know the user at this point, so we only store `challenge => true`.
 */
const loginChallengeMap = new Map<string, boolean>()

// Relying Party (RP) info
const rpID = "example.com" // Must match your domain
const rpName = "EXAMPLE_APP" // Display name for your RP
const ORIGIN = "ORIGIN" // Replace with your app's origin

export function uint8ArrayToBase64Url(uint8Array: Uint8Array): string {
    const base64String = Buffer.from(uint8Array).toString("base64")
    const base64UrlString = base64String
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "")
    return base64UrlString
}

export function base64urlToUint8Array(base64url: string): Uint8Array {
    const padding = "=".repeat((4 - (base64url.length % 4)) % 4)
    const base64 = (base64url + padding).replace(/\-/g, "+").replace(/_/g, "/")

    const rawData = atob(base64)
    const outputArray = new Uint8Array(rawData.length)

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i)
    }

    return outputArray
}

/**
 * Takes a Base64URL-encoded COSE key for P-256 (ES256),
 * parses it to get the X, Y coordinates as hex.
 */
export function parseCoseP256Key(coseB64Url: string) {
    // 1. Convert from Base64URL to raw bytes
    const base64 = coseB64Url.replace(/-/g, "+").replace(/_/g, "/")
    // Add padding if needed
    const pad = 4 - (base64.length % 4)
    const base64Padded = pad !== 4 ? base64 + "=".repeat(pad) : base64

    const coseBytes = Buffer.from(base64Padded, "base64")

    // 2. CBOR-decode
    const coseStruct = cbor.decodeFirstSync(coseBytes)
    // coseStruct should be a Map or JS object like:
    //   { 1: 2, 3: -7, -1: 1, -2: <Buffer..>, -3: <Buffer..> }

    if (!(coseStruct instanceof Map)) {
        throw new Error("COSE public key is not a CBOR map?")
    }

    // 3. Extract x, y from keys -2, -3 (per RFC 8152)
    const xBuf = coseStruct.get(-2) // Uint8Array or Buffer
    const yBuf = coseStruct.get(-3)

    if (!xBuf || !yBuf) {
        throw new Error("COSE key missing x or y")
    }

    const xHex = Buffer.from(xBuf).toString("hex")
    const yHex = Buffer.from(yBuf).toString("hex")

    return { xHex, yHex }
}

export const app = new Hono()

// Enable CORS so you can call from your React Native app
app.use("*", cors())

// ==========================
// Registration
// ==========================

/**
 * GET /generate-registration-options
 *
 * 1) Generates registration (aka "create passkey") challenge
 * 2) Returns it to client
 * 3) Stores the challenge in-memory
 */
app.post("/generate-registration-options", async (c) => {
    const { userName } = await c.req.json<{ userName: string }>()

    const userId = uuidv4()

    let userRecord = userDB.get(userId)
    if (!userRecord) {
        userRecord = {
            username: userName,
            credentials: {
                credentialID: "",
                publicKey: "",
                counter: 0
            }
        }
        userDB.set(userId, userRecord)
    }

    const options = await generateRegistrationOptions({
        rpName,
        rpID,
        userID: userId,
        userName: userRecord.username,
        // The client also uses alg: -7 (ES256)
        supportedAlgorithmIDs: [-7],
        authenticatorSelection: {
            userVerification: "required",
            residentKey: "required"
        }
    })

    // Store challenge
    registrationChallengeMap.set(userId, options.challenge)

    return c.json(options)
})

/**
 * POST /verify-registration
 *
 * 1) Verifies the registration credential response
 * 2) Stores public key credential in userDB
 */
app.post("/verify-registration", async (c) => {
    const { userId, credential } = await c.req.json<{
        userId: string
        credential: RegistrationResponseJSON
    }>()

    const expectedChallenge = registrationChallengeMap.get(userId)
    if (!expectedChallenge) {
        return c.json({ error: "No challenge found for user" }, 400)
    }

    const userRecord = userDB.get(userId)
    if (!userRecord) {
        return c.json({ error: "User not found" }, 404)
    }

    try {
        const verification = await verifyRegistrationResponse({
            response: credential,
            expectedChallenge,
            expectedRPID: rpID,
            expectedOrigin: ORIGIN, // Replace with your app's origin
            requireUserVerification: true
        })

        const { verified, registrationInfo } = verification
        if (!verified || !registrationInfo) {
            return c.json({ error: "Registration not verified" }, 400)
        }

        const { credentialID, credentialPublicKey, counter } =
            verification.registrationInfo!

        // Store the credential in the user record
        userDB.set(userId, {
            username: userRecord.username,
            credentials: {
                credentialID: uint8ArrayToBase64Url(credentialID),
                publicKey: uint8ArrayToBase64Url(credentialPublicKey),
                counter
            }
        })
        registrationChallengeMap.delete(userId)

        return c.json({ status: "ok", verified: true })
    } catch (err: any) {
        console.error("verify-registration error", err)
        return c.json({ error: err.message }, 400)
    }
})

// ==========================
// Login (Authentication)
// ==========================

/**
 * GET /generate-login-options
 *
 * 1) Generates login (aka "get passkey") challenge
 * 2) Returns it to client
 * 3) Stores the challenge in-memory
 */
app.get("/generate-login-options", async (c) => {
    const options = await generateAuthenticationOptions({
        userVerification: "required",
        rpID // must match
    })

    console.log("options", options)

    loginChallengeMap.set(options.challenge, true)

    return c.json(options)
})

/**
 * POST /verify-login
 *
 * 1) Verifies authentication credential
 * 2) Returns success/failure
 */
app.post("/verify-login", async (c) => {
    const { credential, challenge } = await c.req.json<{
        credential: AuthenticationResponseJSON
        challenge: string
    }>()

    // Check if we still recognize this challenge
    if (!loginChallengeMap.has(challenge)) {
        return c.json({ error: "Challenge not found or expired" }, 400)
    }

    // rawId => which credential was actually used
    const userId = credential.response.userHandle

    if (!userId) return c.json({ error: "UserId Not Found" }, { status: 400 })

    // Find which user in DB has that credential
    const userRecord = userDB.get(userId)
    if (!userRecord) return c.json({ error: "User Not Found" }, { status: 400 })
    try {
        // Perform verification
        const verification = await verifyAuthenticationResponse({
            response: credential,
            expectedChallenge: challenge,
            expectedRPID: rpID,
            expectedOrigin: ORIGIN, // Replace with your app's origin
            authenticator: {
                ...credential,
                credentialID: base64urlToUint8Array(
                    userRecord.credentials.credentialID
                ),
                credentialPublicKey: base64urlToUint8Array(
                    userRecord.credentials.publicKey
                ),
                counter: userRecord.credentials.counter
            }
        })

        const { verified, authenticationInfo } = verification
        if (!verified || !authenticationInfo) {
            return c.json({ error: "Login not verified" }, 400)
        }

        // We can optionally update the counter to prevent replay attacks
        userRecord.credentials.counter = authenticationInfo.newCounter

        // Remove the challenge from the Map so it can't be reused
        loginChallengeMap.delete(challenge)

        // Parse the public key to get the x and y coordinates
        const { xHex, yHex } = parseCoseP256Key(
            userRecord.credentials.publicKey
        )

        return c.json({
            status: "ok",
            verified: true,
            xHex,
            yHex
            // you could also create a session or JWT here
        })
    } catch (err: any) {
        console.error("verify-login error:", err)
        return c.json({ error: err.message }, 400)
    }
})

// Just a root endpoint
app.get("/", (c) => c.text("Passkey server running!"))

const port = 3000

console.log(`Server is running on http://localhost:${port}`)

serve({
    fetch: app.fetch,
    port
})
