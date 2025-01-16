import { ConfigContext, ExpoConfig } from "expo/config"

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
            supportsTablet: true
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
                    }
                }
            ]
        ],
        experiments: {
            typedRoutes: true
        }
    }
}
