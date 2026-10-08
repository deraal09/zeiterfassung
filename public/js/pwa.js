document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Kein Service Worker -> einfach kein Installieren-Button noetig,
      // der Rest der App funktioniert unveraendert weiter.
    });
  }

  const button = document.getElementById('pwa-install-button');
  const dialog = document.getElementById('pwa-install-dialog');
  if (!button || !dialog) return;

  const dialogTitle = document.getElementById('pwa-install-dialog-title');
  const dialogBody = document.getElementById('pwa-install-dialog-body');

  const istStandalone =
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (istStandalone) return;

  const ua = navigator.userAgent || '';
  const istIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const istAndroid = /android/i.test(ua);

  function zeigeAnleitung(html) {
    dialogTitle.textContent = 'App installieren';
    dialogBody.innerHTML = html;
    if (typeof dialog.showModal === 'function') dialog.showModal();
  }

  function anleitungIOS() {
    zeigeAnleitung(
      '<p>Auf dem iPhone/iPad laesst sich die Website ueber Safari als App installieren:</p>' +
        '<ol>' +
        '<li>Tippe unten (bzw. oben) in Safari auf das Teilen-Symbol <span class="meta">(Quadrat mit Pfeil nach oben)</span>.</li>' +
        '<li>Waehle „Zum Home-Bildschirm“.</li>' +
        '<li>Bestaetige oben rechts mit „Hinzufuegen“.</li>' +
        '</ol>' +
        '<p class="hint">Funktioniert nur in Safari, nicht in anderen iOS-Browsern.</p>'
    );
  }

  function anleitungAndroidFallback() {
    zeigeAnleitung(
      '<p>Dieser Browser bietet die Installation nicht automatisch an:</p>' +
        '<ol>' +
        '<li>Oeffne das Menue deines Browsers (meist drei Punkte oben rechts).</li>' +
        '<li>Waehle „App installieren“ oder „Zum Startbildschirm hinzufuegen“.</li>' +
        '</ol>' +
        '<p class="hint">In Chrome erscheint dieser Button normalerweise direkt mit einer Installieren-Option.</p>'
    );
  }

  function anleitungDesktopFallback() {
    zeigeAnleitung(
      '<p>In Chrome oder Edge (Windows/Linux/macOS):</p>' +
        '<ol>' +
        '<li>Klicke auf das Installieren-Symbol in der Adressleiste <span class="meta">(oder Menue ⋮ bzw. ⋯)</span>.</li>' +
        '<li>Waehle „Zeiterfassung installieren“.</li>' +
        '</ol>' +
        '<p class="hint">In Firefox oder Safari ist die Installation als App derzeit nicht moeglich - bitte Chrome oder Edge verwenden, oder die Seite als Lesezeichen speichern.</p>'
    );
  }

  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    button.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    button.hidden = true;
  });

  button.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      return;
    }
    if (istIOS) {
      anleitungIOS();
    } else if (istAndroid) {
      anleitungAndroidFallback();
    } else {
      anleitungDesktopFallback();
    }
  });

  if (istIOS) {
    // iOS kennt kein beforeinstallprompt - der Button muss sofort sichtbar
    // sein, sonst gibt es nie eine Installieren-Moeglichkeit.
    button.hidden = false;
  } else {
    // Andere Browser ohne beforeinstallprompt (z. B. Firefox) bekommen den
    // Button mit Verzoegerung, damit ein evtl. doch noch eintreffendes
    // beforeinstallprompt-Ereignis Vorrang hat.
    setTimeout(() => {
      if (!deferredPrompt) button.hidden = false;
    }, 1500);
  }
});
