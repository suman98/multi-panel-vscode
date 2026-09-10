// WKWebView refuses `window.open` outright: it returns null, and there is no
// pop-up permission a user can grant. VS Code reads that null as "the browser
// blocked opening a new window" and puts up its own Retry dialog — which can
// never succeed, since retrying hits the same wall. Every sign-in link, "open
// in new window", and clicked terminal URL inside an embedded VS Code dies
// there.
//
// So we replace `window.open` in *every* frame (the app's own page, each
// project's code-server iframe, and the webviews VS Code nests inside those)
// with a shim that posts the URL up to the app's top frame and hands back a
// stub window object. Non-null is the whole point: VS Code sees a window, so
// the dialog never appears, and the top frame decides what the URL actually
// deserves — an external browser, or switching to the project it names.

use tauri_plugin_opener::OpenerExt;

/// Injected into every frame at document start.
///
/// Two call shapes have to work, because VS Code uses both: `open(url)`, and
/// `open()` followed by assigning `location.href` on the result (its trick for
/// staying inside the user-gesture window that browsers require).
pub const INIT_SCRIPT: &str = r#"(function () {
  if (window.__mvpPopupBridge) return;
  window.__mvpPopupBridge = true;

  function forward(url) {
    if (!url) return;
    var text = String(url);
    if (!text || text === "about:blank") return;
    try {
      (window.top || window).postMessage({ __mvp: "open-external", url: text }, "*");
    } catch (e) {
      /* A frame we can't reach; nothing useful to do. */
    }
  }

  // Enough of a Window to satisfy the callers: they null out `opener`, set
  // `location.href`, focus it, and later close it.
  function stubWindow(url) {
    var href = url ? String(url) : "about:blank";
    var location = {
      get href() { return href; },
      set href(value) { href = String(value); forward(href); },
      assign: function (value) { this.href = value; },
      replace: function (value) { this.href = value; },
      reload: function () {},
      toString: function () { return href; },
    };
    return {
      closed: false,
      opener: null,
      name: "",
      focus: function () {},
      blur: function () {},
      close: function () { this.closed = true; },
      postMessage: function () {},
      addEventListener: function () {},
      removeEventListener: function () {},
      get location() { return location; },
      set location(value) { location.href = value; },
      document: {
        write: function () {},
        writeln: function () {},
        open: function () {},
        close: function () {},
      },
    };
  }

  window.open = function (url) {
    forward(url);
    return stubWindow(url);
  };
})();
"#;

/// Hands a URL to the system's default browser. Called by the top frame after
/// it decides a forwarded pop-up belongs outside the app.
///
/// Only http(s) gets through: the URLs arrive from inside embedded VS Code
/// instances by way of `postMessage`, so `file:`, `javascript:` and friends
/// have no business being handed to the OS opener.
#[tauri::command]
pub fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let scheme_ok = {
        let lower = url.to_ascii_lowercase();
        lower.starts_with("http://") || lower.starts_with("https://")
    };
    if !scheme_ok {
        return Err(format!("Refusing to open a non-http(s) URL: {url}"));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("Failed to open the link: {e}"))
}
