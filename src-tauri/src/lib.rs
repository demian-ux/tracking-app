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

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Oaki Studio Widget")
                .inner_size(560.0, 720.0)
                .min_inner_size(460.0, 600.0)
                .resizable(true)
                .center()
                .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Oaki Studio Widget");
}
