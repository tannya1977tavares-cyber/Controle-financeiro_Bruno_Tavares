package br.com.tavares.financeiro;

import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

import java.util.HashSet;
import java.util.Set;

/** Ponte entre o app (JavaScript) e o leitor de notificações dos bancos. */
@CapacitorPlugin(name = "AvisosBancos")
public class AvisosBancosPlugin extends Plugin {

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("liberado", NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName()));
        call.resolve(r);
    }

    @PluginMethod
    public void abrirAjustes(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void abrirInfoDoApp(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void pegar(PluginCall call) {
        try {
            JSObject r = new JSObject();
            r.put("itens", new JSArray(Fila.ler(getContext()).toString()));
            call.resolve(r);
        } catch (Exception e) { call.reject("Não deu pra ler os avisos"); }
    }

    @PluginMethod
    public void apagar(PluginCall call) {
        try {
            JSONArray a = call.getArray("chaves", new JSArray());
            Set<String> s = new HashSet<>();
            for (int i = 0; i < a.length(); i++) s.add(a.getString(i));
            Fila.apagar(getContext(), s);
            call.resolve();
        } catch (Exception e) { call.reject("Não deu pra apagar"); }
    }
}
