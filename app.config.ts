import { ConfigContext, ExpoConfig } from "expo/config"

const hostname = "example.com"
const bundleIdentifier = "com.example"

export default ({ config }: ConfigContext): ExpoConfig => {
    return {
        ...config,

        name: "PasskeyTest",
        slug: "PasskeyTest",
        version: "1.0.0",
        orientation: "portrait",
        icon: "./assets/images/icon.png",
        scheme: "myapp",
        userInterfaceStyle: "automatic",
        newArchEnabled: true,
        ios: {
            supportsTablet: true,
            bundleIdentifier,
            associatedDomains: [
                `applinks:${hostname}`,
                `webcredentials:${hostname}`
            ],
            infoPlist: { UIBackgroundModes: ["fetch", "remote-notification"] }
        },
        android: {
            adaptiveIcon: {
                foregroundImage: "./assets/images/adaptive-icon.png",
                backgroundColor: "#ffffff"
            },
            package: "PACKAGE_NAME"
        },
        web: {
            bundler: "metro",
            output: "static",
            favicon: "./assets/images/favicon.png"
        },
        plugins: [
            "expo-router",
            [
                "expo-splash-screen",
                {
                    image: "./assets/images/splash-icon.png",
                    imageWidth: 200,
                    resizeMode: "contain",
                    backgroundColor: "#ffffff"
                }
            ],
            [
                "expo-build-properties",
                {
                    android: {
                        compileSdkVersion: 35
                    },
                    ios: {
                        deploymentTarget: "15.1"
                    }
                }
            ]
        ],
        experiments: {
            typedRoutes: true
        }
    }
}
