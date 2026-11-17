package com.ciba.garcia

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object GarciaLog {
    private const val PREFS = "garcia_diagnostics"
    private const val KEY = "entries"
    private const val LIMIT = 150

    @Synchronized
    fun record(context: Context, area: String, error: Throwable) {
        val message = (error.message ?: error.javaClass.simpleName)
            .replace(Regex("(?i)bearer\\s+\\S+"), "Bearer [redigido]")
            .replace(Regex("[A-Za-z0-9_-]{28,}"), "[dado redigido]")
            .take(240)
        val entry = JSONObject()
            .put("time", SimpleDateFormat("dd/MM HH:mm:ss", Locale("pt", "BR")).format(Date()))
            .put("area", area.take(40))
            .put("type", error.javaClass.simpleName.take(80))
            .put("message", message)
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val old = runCatching { JSONArray(prefs.getString(KEY, "[]")) }.getOrElse { JSONArray() }
        val next = JSONArray()
        for (i in maxOf(0, old.length() - LIMIT + 1) until old.length()) next.put(old.getJSONObject(i))
        next.put(entry)
        prefs.edit().putString(KEY, next.toString()).apply()
        Log.e("GarciaDiagnostics", area + ": " + error.javaClass.simpleName + ": " + message)
    }

    fun read(context: Context): String {
        val array = runCatching {
            JSONArray(context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]"))
        }.getOrElse { JSONArray() }
        if (array.length() == 0) return "Nenhum erro registrado."
        return buildString {
            for (i in 0 until array.length()) {
                val item = array.getJSONObject(i)
                append(item.optString("time")).append(" · ")
                    .append(item.optString("area")).append("\n")
                    .append(item.optString("type")).append(": ")
                    .append(item.optString("message")).append("\n\n")
            }
        }.trim()
    }

    fun clear(context: Context) {
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY).apply()
    }
}
