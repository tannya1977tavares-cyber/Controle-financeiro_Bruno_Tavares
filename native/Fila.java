package br.com.tavares.financeiro;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/** Guarda no celular as notificações dos bancos até o app abrir e mandar pro banco de dados. */
public class Fila {
    private static final String ARQ = "avisos_bancos", CHAVE = "fila";
    private static final int MAX = 2000;

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(ARQ, Context.MODE_PRIVATE); }

    static synchronized JSONArray ler(Context c) {
        try { return new JSONArray(prefs(c).getString(CHAVE, "[]")); } catch (Exception e) { return new JSONArray(); }
    }

    static synchronized void adicionar(Context c, String pkg, String titulo, String texto, long quando) {
        try {
            JSONArray a = ler(c);
            String chave = pkg + "|" + quando + "|" + (titulo + texto).hashCode();
            for (int i = 0; i < a.length(); i++) if (chave.equals(a.getJSONObject(i).optString("chave"))) return;
            JSONObject o = new JSONObject();
            o.put("chave", chave); o.put("pkg", pkg); o.put("titulo", titulo); o.put("texto", texto); o.put("quando", quando);
            a.put(o);
            while (a.length() > MAX) a.remove(0);
            prefs(c).edit().putString(CHAVE, a.toString()).apply();
        } catch (Exception ignored) {}
    }

    static synchronized void apagar(Context c, Set<String> chaves) {
        try {
            JSONArray a = ler(c), b = new JSONArray();
            for (int i = 0; i < a.length(); i++) if (!chaves.contains(a.getJSONObject(i).optString("chave"))) b.put(a.getJSONObject(i));
            prefs(c).edit().putString(CHAVE, b.toString()).apply();
        } catch (Exception ignored) {}
    }
}
