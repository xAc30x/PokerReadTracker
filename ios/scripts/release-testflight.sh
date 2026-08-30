#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ios_directory="$(cd "$script_directory/.." && pwd)"

marketing_version="${MARKETING_VERSION:-1.0.0}"
build_number="${BUILD_NUMBER:-1}"
upload_to_testflight="${UPLOAD_TO_TESTFLIGHT:-true}"
runner_temp="${RUNNER_TEMP:-}"

if [[ -z "$runner_temp" || "$runner_temp" == "/" ]]; then
  echo "::error::RUNNER_TEMP must resolve to a dedicated temporary directory."
  exit 2
fi

required_variables=(
  APPLE_DISTRIBUTION_CERTIFICATE_BASE64
  APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD
  APPLE_PROVISIONING_PROFILE_BASE64
)

if [[ "$upload_to_testflight" == "true" ]]; then
  required_variables+=(
    APP_STORE_CONNECT_API_KEY_ID
    APP_STORE_CONNECT_API_ISSUER_ID
    APP_STORE_CONNECT_API_PRIVATE_KEY_BASE64
  )
fi

for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "::error::$variable_name is not configured."
    exit 3
  fi
done

if [[ ! "$marketing_version" =~ ^[0-9]+(\.[0-9]+){2}$ ]]; then
  echo "::error::MARKETING_VERSION must contain three numeric components."
  exit 4
fi

if [[ ! "$build_number" =~ ^[1-9][0-9]*(\.[0-9]+){0,2}$ ]]; then
  echo "::error::BUILD_NUMBER must be a valid positive CFBundleVersion."
  exit 5
fi

for command_name in base64 openssl plutil security xcodebuild xcodegen xcrun; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "::error::$command_name is required on the release runner."
    exit 6
  fi
done

secret_directory="$(mktemp -d "$runner_temp/tableread-signing.XXXXXX")"
artifact_directory="$(mktemp -d "$runner_temp/tableread-artifacts.XXXXXX")"
certificate_path="$secret_directory/distribution.p12"
profile_path="$secret_directory/distribution.mobileprovision"
profile_plist="$secret_directory/profile.plist"
keychain_path="$secret_directory/signing.keychain-db"
archive_path="$artifact_directory/TableRead.xcarchive"
export_path="$artifact_directory/export"
export_options_path="$secret_directory/ExportOptions.plist"
api_key_path=""
installed_profile_path=""
keychain_password="$(openssl rand -hex 32)"

decode_base64() {
  if base64 --decode </dev/null >/dev/null 2>&1; then
    base64 --decode
  else
    base64 -D
  fi
}

cleanup() {
  if [[ -n "$installed_profile_path" && -f "$installed_profile_path" ]]; then
    rm -f "$installed_profile_path"
  fi
  if [[ -f "$keychain_path" ]]; then
    security delete-keychain "$keychain_path" >/dev/null 2>&1 || true
  fi
  rm -rf "$secret_directory"
}
trap cleanup EXIT

printf '%s' "$APPLE_DISTRIBUTION_CERTIFICATE_BASE64" | decode_base64 > "$certificate_path"
printf '%s' "$APPLE_PROVISIONING_PROFILE_BASE64" | decode_base64 > "$profile_path"

security create-keychain -p "$keychain_password" "$keychain_path"
security set-keychain-settings -lut 21600 "$keychain_path"
security unlock-keychain -p "$keychain_password" "$keychain_path"
security import "$certificate_path" \
  -P "$APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD" \
  -A -t cert -f pkcs12 -k "$keychain_path"
security set-key-partition-list \
  -S apple-tool:,apple: \
  -k "$keychain_password" \
  "$keychain_path" >/dev/null
security list-keychains -d user -s "$keychain_path"

if ! security find-identity -v -p codesigning "$keychain_path" | grep -q 'Apple Distribution'; then
  echo "::error::The imported certificate does not contain an Apple Distribution signing identity."
  exit 7
fi

security cms -D -i "$profile_path" > "$profile_plist"
profile_uuid="$(/usr/libexec/PlistBuddy -c 'Print :UUID' "$profile_plist")"
profile_name="$(/usr/libexec/PlistBuddy -c 'Print :Name' "$profile_plist")"
profile_team_id="$(/usr/libexec/PlistBuddy -c 'Print :TeamIdentifier:0' "$profile_plist")"
profile_app_id_prefix="$(/usr/libexec/PlistBuddy -c 'Print :ApplicationIdentifierPrefix:0' "$profile_plist")"
application_identifier="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$profile_plist")"
bundle_id="${application_identifier#"$profile_app_id_prefix."}"
get_task_allow="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:get-task-allow' "$profile_plist" 2>/dev/null || printf 'false')"
beta_reports_active="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:beta-reports-active' "$profile_plist" 2>/dev/null || printf 'false')"
provisioned_devices="$(/usr/libexec/PlistBuddy -c 'Print :ProvisionedDevices' "$profile_plist" 2>/dev/null || true)"

if [[ -z "$profile_uuid" || -z "$profile_name" || -z "$profile_team_id" || -z "$profile_app_id_prefix" || -z "$bundle_id" ]]; then
  echo "::error::The provisioning profile is missing required App Store signing metadata."
  exit 8
fi

if [[ "$get_task_allow" == "true" ]]; then
  echo "::error::A development profile was provided. Use an App Store distribution profile."
  exit 9
fi

if [[ "$beta_reports_active" != "true" || -n "$provisioned_devices" || "$bundle_id" == *'*'* ]]; then
  echo "::error::The provisioning profile is not an explicit App Store Connect distribution profile."
  exit 9
fi

profiles_directory="$HOME/Library/MobileDevice/Provisioning Profiles"
mkdir -p "$profiles_directory"
installed_profile_path="$profiles_directory/$profile_uuid.mobileprovision"
cp "$profile_path" "$installed_profile_path"

cd "$ios_directory"
xcodegen generate

xcodebuild \
  -project TableReadApp.xcodeproj \
  -scheme TableReadApp \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$archive_path" \
  TABLE_READ_BUNDLE_ID="$bundle_id" \
  MARKETING_VERSION="$marketing_version" \
  CURRENT_PROJECT_VERSION="$build_number" \
  DEVELOPMENT_TEAM="$profile_team_id" \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="Apple Distribution" \
  CODE_SIGNING_ALLOWED=YES \
  PROVISIONING_PROFILE_SPECIFIER="$profile_name" \
  clean archive

plutil -create xml1 "$export_options_path"
/usr/libexec/PlistBuddy -c 'Add :method string app-store-connect' "$export_options_path"
/usr/libexec/PlistBuddy -c 'Add :destination string export' "$export_options_path"
/usr/libexec/PlistBuddy -c 'Add :signingStyle string manual' "$export_options_path"
/usr/libexec/PlistBuddy -c "Add :teamID string $profile_team_id" "$export_options_path"
/usr/libexec/PlistBuddy -c 'Add :stripSwiftSymbols bool true' "$export_options_path"
/usr/libexec/PlistBuddy -c 'Add :uploadSymbols bool true' "$export_options_path"
/usr/libexec/PlistBuddy -c 'Add :provisioningProfiles dict' "$export_options_path"
/usr/libexec/PlistBuddy -c "Add :provisioningProfiles:$bundle_id string $profile_name" "$export_options_path"

xcodebuild \
  -exportArchive \
  -archivePath "$archive_path" \
  -exportPath "$export_path" \
  -exportOptionsPlist "$export_options_path"

ipa_path="$(find "$export_path" -maxdepth 1 -type f -name '*.ipa' -print -quit)"
if [[ -z "$ipa_path" || ! -f "$ipa_path" ]]; then
  echo "::error::Xcode did not export a signed IPA."
  exit 10
fi

if [[ "$upload_to_testflight" == "true" ]]; then
  if [[ ! "$APP_STORE_CONNECT_API_KEY_ID" =~ ^[A-Z0-9]{10}$ ]]; then
    echo "::error::APP_STORE_CONNECT_API_KEY_ID must be a 10-character App Store Connect key ID."
    exit 11
  fi

  if [[ ! "$APP_STORE_CONNECT_API_ISSUER_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
    echo "::error::APP_STORE_CONNECT_API_ISSUER_ID must be an App Store Connect issuer UUID."
    exit 12
  fi

  api_key_path="$secret_directory/AuthKey_${APP_STORE_CONNECT_API_KEY_ID}.p8"
  printf '%s' "$APP_STORE_CONNECT_API_PRIVATE_KEY_BASE64" | decode_base64 > "$api_key_path"
  chmod 600 "$api_key_path"

  export API_PRIVATE_KEYS_DIR="$secret_directory"

  xcrun altool \
    --validate-app \
    --file "$ipa_path" \
    --type ios \
    --apiKey "$APP_STORE_CONNECT_API_KEY_ID" \
    --apiIssuer "$APP_STORE_CONNECT_API_ISSUER_ID"

  xcrun altool \
    --upload-app \
    --file "$ipa_path" \
    --type ios \
    --apiKey "$APP_STORE_CONNECT_API_KEY_ID" \
    --apiIssuer "$APP_STORE_CONNECT_API_ISSUER_ID"
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "ipa_path=$ipa_path"
    echo "artifact_directory=$artifact_directory"
    echo "bundle_id=$bundle_id"
    echo "marketing_version=$marketing_version"
    echo "build_number=$build_number"
    echo "uploaded=$upload_to_testflight"
  } >> "$GITHUB_OUTPUT"
fi

echo "TableRead $marketing_version ($build_number) archived for $bundle_id."
if [[ "$upload_to_testflight" == "true" ]]; then
  echo "The signed IPA was accepted for App Store Connect upload."
else
  echo "The signed IPA was exported without uploading."
fi
