# React Native Passkeys Example

This repo is a sample app demonstrating how to use passkeys with the ZeroDev SDK.

## Installation

```bash
npm install
```

## Zerodev Integration

### Using Custom Library

You can use any custom library you want to integrate passkeys with your app. But you might need to implement your own logic for `parsePasskeyCred` and `signMessageCallback`. Refer to the [react-native-passkeys-utils](https://github.com/zerodevapp/sdk/tree/main/plugins/react-native-passkeys-utils) for more details. You can use the following code if you use [react-native-passkeys](https://github.com/peterferguson/react-native-passkeys) library.

```typescript
import { toWebAuthnKey, WebAuthnKey } from "@zerodev/webauthn-key"
import {
    parsePasskeyCred,
    signMessageWithReactNativePasskeys
} from "@zerodev/react-native-passkeys-utils"

const parsedKey = await parsePasskeyCred(
    json as unknown as RegistrationResponseJSON,
    rp.id
)

webAuthnKey = await toWebAuthnKey({
    webAuthnKey: {
        ...parsedKey,
        signMessageCallback: signMessageWithReactNativePasskeys
    },
    rpID: rp.id
})
```

### Running a passkey server

Passkey accounts require public keys of the passkey to derive the corresponding smart account address. So, you may need to run a passkey server to store your user's passkeys. Since public keys are only retrieved during the creation process -- not during authentication or login -- you must store these public keys on your server if you want to construct a passkey account when authentication. Here is a reference implementation of a passkey server: [passkey-server](https://github.com/zerodevapp/passkey-server/blob/main/src/routes/v4.ts).

## iOS Setup

#### 1. Host an Apple App Site Association (AASA) file

For Passkeys to work on iOS, you'll need to host an AASA file on your domain. This file is used to verify that your app is allowed to handle the domain you are trying to authenticate with. This must be hosted on a site with a valid SSL certificate.

The file should be hosted at:

```
https://<your_domain>/.well-known/apple-app-site-association
```

Note there is no `.json` extension for this file but the format is json. The contents of the file should look something like this:

```json
{
    "webcredentials": {
        "apps": ["<teamID>.<bundleID>"]
    }
}
```

Replace `<teamID>` with your Apple Team ID and `<bundleID>` with your app's bundle identifier.

#### 2. Add Associated Domains

Add the following to your `app.config.ts`:

```typescript
export default ({ config }: ConfigContext): ExpoConfig => {
    return {
        ...config,
        // ...
        ios: {
            associatedDomains: ["webcredentials:<your_domain>"]
        }
    }
}
```

Replace `<your_domain>` with the domain you are hosting the AASA file on. For example, if you are hosting the AASA file on `https://example.com/.well-known/apple-app-site-association`, you would add `example.com` to the `associatedDomains` array.

#### 3. Add minimum deployment target

Add the following to your `app.config.ts`:

```typescript
export default ({ config }: ConfigContext): ExpoConfig => {
    return {
        ...config,
        // ...
        plugins: [
            // ...
            [
                "expo-build-properties",
                {
                    ios: {
                        deploymentTarget: "15.1"
                    }
                }
            ]
        ]
    }
}
```

#### 4. Prebuild and run your app

```sh
npx expo prebuild -p ios
npx expo run:ios # or build in the cloud with EAS
```

## Android Setup

#### 1. Host an `assetlinks.json` File

For Passkeys to work on Android, you'll need to host an `assetlinks.json` file on your domain. This file is used to verify that your app is allowed to handle the domain you are trying to authenticate with. This must be hosted on a site with a valid SSL certificate.

The file should be hosted at:

```
https://<your_domain>/.well-known/assetlinks.json
```

and should look something like this (you can generate this file using the [Android Asset Links Assistant](https://developers.google.com/digital-asset-links/tools/generator)):

```json
[
    {
        "relation": ["delegate_permission/common.handle_all_urls"],
        "target": {
            "namespace": "android_app",
            "package_name": "<package_name>",
            "sha256_cert_fingerprints": ["<sha256_cert_fingerprint>"]
        }
    }
]
```

Replace `<package_name>` with your app's package name and `<sha256_cert_fingerprint>` with your app's SHA256 certificate fingerprint.

_Note: if you’re testing the app on your local machine, make sure you use the debug SHA256 fingerprint._

#### 2. Modify Expo Build Properties

Next, you'll need to modify the `compileSdkVersion` in your `app.json` to be at least 34.

```typescript
export default ({ config }: ConfigContext): ExpoConfig => {
    return {
        ...config,
        // ...
        plugins: [
            // ...
            [
                "expo-build-properties",
                {
                    android: {
                        compileSdkVersion: 34
                    }
                }
            ]
        ]
    }
}
```

#### 3. Prebuild and run your app

```sh
npx expo prebuild -p android
npx expo run:android # or build in the cloud with EAS
```
