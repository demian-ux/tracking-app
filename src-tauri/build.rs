fn main() {
    // Prevent shipping an installer that points to localhost.
    // Set OAKI_WIDGET_URL before running `tauri build` / `npm run tauri:build`.
    if std::env::var("PROFILE").as_deref() == Ok("release")
        && std::env::var("OAKI_WIDGET_URL").is_err()
    {
        panic!(
            "\n\n\
            OAKI_WIDGET_URL is not set.\n\
            The production installer must load the hosted app, not localhost.\n\n\
            Set it before building:\n\
              PowerShell:  $env:OAKI_WIDGET_URL = \"https://yourdomain.com/app/widget\"\n\
              bash/macOS:  export OAKI_WIDGET_URL=https://yourdomain.com/app/widget\n\n\
            Then run:  npm run tauri:build\n"
        );
    }
    tauri_build::build()
}
