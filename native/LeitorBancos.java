package br.com.tavares.financeiro;

import android.app.Notification;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

/** Fica ouvindo as notificações e guarda só as dos bancos. O resto é ignorado na hora. */
public class LeitorBancos extends NotificationListenerService {

    static boolean ehBanco(String pkg) {
        if (pkg == null) return false;
        switch (pkg) {
            case "com.nu.production": case "com.itau": case "com.itau.empresas": case "com.bradesco":
            case "br.com.bradesco.next": case "com.santander.app": case "br.com.bb.android":
            case "br.com.gabba.Caixa": case "br.gov.caixa.tem": case "br.com.intermedium":
            case "com.c6bank.app": case "com.picpay": case "com.mercadopago.wallet":
            case "br.com.uol.ps.myaccount": case "br.com.sicoobnet": case "com.sicredi.app":
            case "br.com.sicredi.app": case "com.neon":
                return true;
        }
        String p = pkg.toLowerCase();
        return p.contains("sicredi") || p.contains("sicoob");
    }

    /* O Android às vezes desliga o leitor sem avisar (economia de bateria, atualização do app).
       Aí as notificações param de entrar até alguém religar. Isto pede pro sistema ligar de novo. */
    static void religar(Context c) {
        try {
            ComponentName cn = new ComponentName(c, LeitorBancos.class);
            if (!conectado(c)) {
                PackageManager pm = c.getPackageManager();
                pm.setComponentEnabledSetting(cn, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
                pm.setComponentEnabledSetting(cn, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
            }
            NotificationListenerService.requestRebind(cn);
        } catch (Exception ignored) {}
    }

    static boolean conectado(Context c) { return c.getSharedPreferences("avisos_bancos", Context.MODE_PRIVATE).getBoolean("conectado", false); }
    private void marcar(String chave, boolean v) { getSharedPreferences("avisos_bancos", MODE_PRIVATE).edit().putBoolean(chave, v).putLong(chave + "_em", System.currentTimeMillis()).apply(); }

    private void guardar(StatusBarNotification sbn) {
        if (sbn == null || !ehBanco(sbn.getPackageName())) return;
        getSharedPreferences("avisos_bancos", MODE_PRIVATE).edit().putLong("ultimo_aviso", System.currentTimeMillis()).apply();
        Notification n = sbn.getNotification();
        if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
        Bundle ex = n.extras;
        if (ex == null) return;
        CharSequence t = ex.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence big = ex.getCharSequence(Notification.EXTRA_BIG_TEXT);
        CharSequence txt = big != null ? big : ex.getCharSequence(Notification.EXTRA_TEXT);
        if (txt == null && t == null) return;
        Fila.adicionar(this, sbn.getPackageName(), t == null ? "" : t.toString(), txt == null ? "" : txt.toString(), sbn.getPostTime());
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try { guardar(sbn); } catch (Exception ignored) {}
    }

    @Override
    public void onListenerDisconnected() {
        marcar("conectado", false);
        try { requestRebind(new ComponentName(this, LeitorBancos.class)); } catch (Exception ignored) {}
    }

    @Override
    public void onListenerConnected() {
        marcar("conectado", true);
        try {
            StatusBarNotification[] ativas = getActiveNotifications();
            if (ativas != null) for (StatusBarNotification s : ativas) guardar(s);
        } catch (Exception ignored) {}
    }
}
