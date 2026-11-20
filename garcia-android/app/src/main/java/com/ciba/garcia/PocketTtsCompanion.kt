package com.ciba.garcia

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings

/**
 * Optional companion runtime for Pocket TTS voice cloning.
 *
 * The engine keeps its model packs and reference recordings in its own private
 * storage. Garcia only delegates speech through Android's selected TTS engine.
 */
internal object PocketTtsCompanion {
    const val PACKAGE_NAME = "org.pockettts.android.engine"
    const val RELEASES_URL = "https://github.com/The-unknown-Shadowman/PocketTTS-Android-Engine/releases/latest"

    fun isInstalled(context: Context): Boolean = runCatching {
        context.packageManager.getPackageInfo(PACKAGE_NAME, 0)
        true
    }.getOrDefault(false)

    fun open(context: Context): Boolean {
        val launchIntent = context.packageManager.getLaunchIntentForPackage(PACKAGE_NAME) ?: return false
        return runCatching {
            context.startActivity(launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        }.getOrDefault(false)
    }

    fun openReleasePage(context: Context) {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(RELEASES_URL)))
    }

    fun openTextToSpeechSettings(context: Context) {
        val intent = Intent("com.android.settings.TTS_SETTINGS")
        runCatching { context.startActivity(intent) }.onFailure {
            context.startActivity(Intent(Settings.ACTION_SETTINGS))
        }
    }

    fun supportsArm64(context: Context): Boolean =
        android.os.Build.SUPPORTED_ABIS.any { it.equals("arm64-v8a", ignoreCase = true) }
}
