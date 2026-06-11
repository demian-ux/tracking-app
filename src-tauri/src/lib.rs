use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

// URL is baked in at build time.
// Set OAKI_WIDGET_URL before running `tauri build` for production.
// Example: set OAKI_WIDGET_URL=https://yourdomain.com/app/widget && npm run tauri:build
fn widget_url() -> &'static str {
    option_env!("OAKI_WIDGET_URL").unwrap_or("http://localhost:3000/app/widget")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let url: tauri::Url = widget_url()
                .parse()
                .expect("OAKI_WIDGET_URL is not a valid URL");

            // Release builds must point at HTTPS — a plain-http widget URL in a
            // shipped installer would let a network attacker inject code into
            // the desktop webview.
            #[cfg(not(debug_assertions))]
            assert_eq!(
                url.scheme(),
                "https",
                "OAKI_WIDGET_URL must be an https:// URL for release builds"
            );

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("OAKI Tracker")
                .inner_size(560.0, 720.0)
                .min_inner_size(460.0, 600.0)
                .resizable(true)
                .center()
                .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running OAKI Tracker");
}
