import {
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import * as Application from "expo-application"
import * as passkey from "react-native-passkeys"
import alert from "../utils/alert"
import React from "react"
import base64 from "@hexagon/base64"
import {
    AuthenticationResponseJSON,
    Base64URLString,
    RegistrationResponseJSON
} from "@simplewebauthn/typescript-types"
import { toWebAuthnKey, WebAuthnKey } from "@zerodev/webauthn-key"
import {
    parsePasskeyCred,
    parseLoginCred,
    signMessageWithReactNativePasskeys
} from "@zerodev/react-native-passkeys-utils"
import { Address, createPublicClient, http, keccak256, zeroAddress } from "viem"
import { sepolia } from "viem/chains"
import {
    PasskeyValidatorContractVersion,
    toPasskeyValidator
} from "@zerodev/passkey-validator"
import {
    createKernelAccount,
    createKernelAccountClient,
    createZeroDevPaymasterClient,
    getUserOperationGasPrice
} from "@zerodev/sdk"
import { KERNEL_V3_1 } from "@zerodev/sdk/constants"
import {
    entryPoint07Address,
    EntryPointVersion
} from "viem/account-abstraction"

// passkey server url
const PASSKEY_SERVER_URL = "YOUR_PASSKEY_SERVER_URL"

// ZeroDev related
const BUNDLER_RPC = "BUNDLER_RPC"
const PAYMASTER_RPC = "PAYMASTER_RPC"

const chain = sepolia
const entryPoint = {
    address: entryPoint07Address as Address,
    version: "0.7" as EntryPointVersion
}
const kernelVersion = KERNEL_V3_1
const publicClient = createPublicClient({
    transport: http(BUNDLER_RPC),
    chain
})

// ! taken from https://github.com/MasterKale/SimpleWebAuthn/blob/e02dce6f2f83d8923f3a549f84e0b7b3d44fa3da/packages/browser/src/helpers/bufferToBase64URLString.ts
/**
 * Convert the given array buffer into a Base64URL-encoded string. Ideal for converting various
 * credential response ArrayBuffers to string for sending back to the server as JSON.
 *
 * Helper method to compliment `base64URLStringToBuffer`
 */
export function bufferToBase64URLString(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let str = ""

    for (const charCode of bytes) {
        str += String.fromCharCode(charCode)
    }

    const base64String = btoa(str)

    return base64String
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "")
}

// ! taken from https://github.com/MasterKale/SimpleWebAuthn/blob/e02dce6f2f83d8923f3a549f84e0b7b3d44fa3da/packages/browser/src/helpers/utf8StringToBuffer.ts
/**
 * A helper method to convert an arbitrary string sent from the server to an ArrayBuffer the
 * authenticator will expect.
 */
export function utf8StringToBuffer(value: string): ArrayBuffer {
    return new TextEncoder().encode(value)
}

/**
 * Decode a base64url string into its original string
 */
export function base64UrlToString(base64urlString: Base64URLString): string {
    return base64.toString(base64urlString, true)
}

const rp = {
    id: "example.com",
    name: "EXAMPLE_APP"
} satisfies PublicKeyCredentialRpEntity

let webAuthnKey: WebAuthnKey

export default function App() {
    const insets = useSafeAreaInsets()

    const [result, setResult] = React.useState<any>(null)
    const [creationResponse, setCreationResponse] = React.useState<
        | NonNullable<Awaited<ReturnType<typeof passkey.create>>>["response"]
        | null
    >(null)
    const [loginResponse, setLoginResponse] = React.useState<
        NonNullable<Awaited<ReturnType<typeof passkey.get>>>["response"] | null
    >(null)
    const [credentialId, setCredentialId] = React.useState("")

    const createPasskey = async () => {
        try {
            // 1) Fetch registration options from server
            const registrationOptions = await fetch(
                `${PASSKEY_SERVER_URL}/generate-registration-options`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        userName: "charlie"
                    })
                }
            ).then((res) => res.json())

            // 2) Now call passkey.create(...) with the data from server
            const creationResponse = await passkey.create({
                challenge: registrationOptions.challenge,
                pubKeyCredParams: registrationOptions.pubKeyCredParams,
                rp: registrationOptions.rp,
                user: {
                    id: registrationOptions.user.id,
                    name: registrationOptions.user.name,
                    displayName: registrationOptions.user.displayName
                },
                authenticatorSelection:
                    registrationOptions.authenticatorSelection,
                ...(Platform.OS !== "android" && {
                    extensions: { largeBlob: { support: "required" } }
                })
            })

            console.log("creation response -", creationResponse)

            if (!creationResponse) {
                throw new Error("No response from passkey.create")
            }

            if (creationResponse?.rawId) setCredentialId(creationResponse.rawId)
            if (creationResponse?.response)
                setCreationResponse(creationResponse.response)

            setResult(creationResponse)

            // 3) Send passkey response to server to verify & store
            await fetch(`${PASSKEY_SERVER_URL}/verify-registration`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId: registrationOptions.user.id,
                    credential: creationResponse
                })
            })
                .then((r) => r.json())
                .then((res) => {
                    console.log("Server verify-registration response:", res)
                    if (res.error) alert("Registration failed", res.error)
                })

            // 4) Parse passkey to build WebAuthnKey for ZeroDev usage
            const parsedKey = parsePasskeyCred(
                creationResponse as unknown as RegistrationResponseJSON,
                rp.id
            )

            webAuthnKey = await toWebAuthnKey({
                webAuthnKey: {
                    ...parsedKey,
                    signMessageCallback: signMessageWithReactNativePasskeys
                },
                rpID: rp.id
            })
        } catch (e) {
            console.error("create error", e)
            alert("Failed to create passkey", String(e))
        }
    }

    /**
     * 2. Login: get challenge from server, call passkey.get, then verify
     */
    const authenticatePasskey = async () => {
        try {
            // 1) Fetch login options from server
            const loginOptions = await fetch(
                `${PASSKEY_SERVER_URL}/generate-login-options`
            ).then((res) => res.json())

            if (loginOptions?.error) {
                alert("Error generating login options", loginOptions.error)
                return
            }

            // 2) call passkey.get(...) with data from server
            const loginResponse = await passkey.get({
                rpId: rp.id,
                challenge: loginOptions.challenge,
                allowCredentials: loginOptions.allowCredentials,
                userVerification: loginOptions.userVerification
            })

            if (loginResponse?.rawId) setCredentialId(loginResponse.rawId)
            if (loginResponse?.response)
                setLoginResponse(loginResponse.response)

            setResult(loginResponse)

            // 3) send to server to verify
            const verifyResponse = await fetch(
                `${PASSKEY_SERVER_URL}/verify-login`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        credential: loginResponse,
                        challenge: loginOptions.challenge
                    })
                }
            ).then((r) => r.json())

            const parsedKey = parseLoginCred(
                loginResponse as unknown as AuthenticationResponseJSON,
                verifyResponse.xHex,
                verifyResponse.yHex,
                rp.id
            )

            webAuthnKey = await toWebAuthnKey({
                webAuthnKey: {
                    ...parsedKey,
                    signMessageCallback: signMessageWithReactNativePasskeys
                },
                rpID: rp.id
            })
        } catch (err) {
            console.error("authenticatePasskey error", err)
            alert("Failed to authenticate passkey", String(err))
        }
    }

    /**
     * 3. Example ZeroDev userOp with the newly created WebAuthn key
     */
    const sendUserOp = async () => {
        if (!webAuthnKey) {
            alert("No webAuthnKey found. Register a passkey first.")
            return
        }

        const passkeyValidator = await toPasskeyValidator(publicClient, {
            webAuthnKey,
            entryPoint,
            kernelVersion,
            validatorContractVersion: PasskeyValidatorContractVersion.V0_0_2
        })

        const account = await createKernelAccount(publicClient, {
            plugins: {
                sudo: passkeyValidator
            },
            entryPoint,
            kernelVersion
        })
        console.log("My account:", account.address)

        const paymasterClient = createZeroDevPaymasterClient({
            chain,
            transport: http(PAYMASTER_RPC)
        })

        const kernelClient = createKernelAccountClient({
            account,
            chain,
            bundlerTransport: http(BUNDLER_RPC),
            client: publicClient,
            paymaster: paymasterClient,
            userOperation: {
                estimateFeesPerGas: async ({ bundlerClient }) => {
                    return getUserOperationGasPrice(bundlerClient)
                }
            }
        })

        console.log("sending user op")
        const userOpHash = await kernelClient.sendUserOperation({
            callData: await account.encodeCalls([
                {
                    to: zeroAddress,
                    value: BigInt(0),
                    data: "0x"
                }
            ])
        })

        console.log("userOp hash:", userOpHash)

        const _receipt = await kernelClient.waitForUserOperationReceipt({
            hash: userOpHash
        })
        console.log({ txHash: _receipt.receipt.transactionHash })

        console.log("userOp completed")
    }

    return (
        <View style={{ flex: 1 }}>
            <ScrollView
                style={{
                    paddingTop: insets.top,
                    backgroundColor: "#fccefe",
                    paddingBottom: insets.bottom
                }}
                contentContainerStyle={styles.scrollContainer}
            >
                <Text style={styles.title}>Testing Passkeys</Text>
                <Text>Application ID: {Application.applicationId}</Text>
                <Text>
                    Passkeys are{" "}
                    {passkey.isSupported() ? "Supported" : "Not Supported"}
                </Text>
                {credentialId && (
                    <Text>User Credential ID: {credentialId}</Text>
                )}
                <View style={styles.buttonContainer}>
                    <Pressable style={styles.button} onPress={createPasskey}>
                        <Text>Create</Text>
                    </Pressable>
                    <Pressable
                        style={styles.button}
                        onPress={authenticatePasskey}
                    >
                        <Text>Login</Text>
                    </Pressable>
                    {(creationResponse || loginResponse) && (
                        <Pressable
                            style={styles.button}
                            onPress={async () => {
                                try {
                                    await sendUserOp()
                                    alert("UserOp sent!")
                                } catch (e) {
                                    console.error(e)
                                    alert("Error sending userOp")
                                }
                            }}
                        >
                            <Text>Send UserOp</Text>
                        </Pressable>
                    )}
                </View>
                {result && (
                    <Text style={styles.resultText}>
                        Result {JSON.stringify(result, null, 2)}
                    </Text>
                )}
            </ScrollView>
        </View>
    )
}

const styles = StyleSheet.create({
    scrollContainer: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center"
    },
    title: {
        fontSize: 20,
        fontWeight: "bold",
        marginVertical: "5%"
    },
    resultText: {
        maxWidth: "80%"
    },
    buttonContainer: {
        padding: 24,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        rowGap: 4,
        justifyContent: "space-evenly"
    },
    button: {
        backgroundColor: "#fff",
        padding: 10,
        borderWidth: 1,
        borderRadius: 5,
        width: "45%",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center"
    }
})
