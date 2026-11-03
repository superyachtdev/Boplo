/* Native-shell hooks for the Capacitor iOS app.
   Safari, Chrome and the installed PWA have no Capacitor bridge, so this file returns immediately and changes nothing for them.
   The iOS shell injects the bridge. The hooks only adjust that shell. */
(function () {
  try {
    var cap = window.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return;
    var plugins = cap.Plugins || {};
    if (plugins.StatusBar) {
      Promise.resolve(plugins.StatusBar.setStyle({ style: 'DARK' })).catch(function () {});
      Promise.resolve(plugins.StatusBar.setBackgroundColor({ color: '#020611' })).catch(function () {});
    }
    if (plugins.SplashScreen && plugins.SplashScreen.hide) {
      Promise.resolve(plugins.SplashScreen.hide()).catch(function () {});
    }
    // A magic-link or other https://boplo.app URL that iOS handed back to the app.
    // The WebView has to open it itself, or the session cookie is set in Safari instead.
    if (plugins.App && typeof plugins.App.addListener === 'function') {
      plugins.App.addListener('appUrlOpen', function (event) {
        try {
          if (!event || !event.url) return;
          var url = new URL(event.url);
          if (url.origin !== 'https://boplo.app') return;
          if (location.href === url.href) return;
          location.href = url.href;
        } catch (e) {}
      });
    }
  } catch (e) {}
})();
