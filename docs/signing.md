# Signing releases

The release workflow builds all six installer formats automatically. Unsigned
builds work, but each OS shows a warning on first launch. This page describes
how to remove those warnings.

## macOS (Gatekeeper)

Without signing, users must right-click → Open on first launch.

1. Join the Apple Developer Program (~$99/yr).
2. Create a **Developer ID Application** certificate and export it as `.p12`.
3. Add these repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|-------|
| `APPLE_CERTIFICATE` | base64 of the `.p12` file |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` export password |
| `APPLE_SIGNING_IDENTITY` | the certificate's identity (e.g. `Developer ID Application: Name (TEAMID)`) |
| `APPLE_ID` | the Apple ID used for notarization |
| `APPLE_PASSWORD` | an app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | your team identifier |

The workflow already reads all of these and will sign + notarize once present.

## Windows (SmartScreen)

Unsigned builds trigger "Windows protected your PC". Users click
More info → Run anyway.

1. Get a code-signing certificate. The cheapest practical option is
   [Azure Trusted Signing](https://azure.microsoft.com/products/trusted-signing)
   (~$10/month, no USB token required); standard OV/EV certificates also work.
2. Store the certificate (`sign.pfx`) and password as `WINDOWS_CERTIFICATE`
   (base64) and `WINDOWS_CERTIFICATE_PASSWORD` secrets.
3. Add a signing step to the Windows job of `.github/workflows/release.yml`
   that imports the `.pfx` and runs `signtool sign` over the built artifacts.

## Linux

No signing required; the workflow builds `.deb` and `.AppImage` as-is.

## Auto-update (optional)

To let the app update itself, add `tauri-plugin-updater` and signing keys, then
publish a `latest.json` manifest. tauri-action can generate the manifest from
the release. Reach out or open an issue if you'd like this wired up.
