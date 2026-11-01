package br.com.tavares.financeiro;

import android.app.Notification;
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

    private void guardar(StatusBarNotification sbn) {
        if (sbn == null || !ehBanco(sbn.getPackageName())) return;
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
    public void onListenerConnected() {
        try {
            StatusBarNotification[] ativas = getActiveNotifications();
            if (ativas != null) for (StatusBarNotification s : ativas) guardar(s);
        } catch (Exception ignored) {}
    }
}
