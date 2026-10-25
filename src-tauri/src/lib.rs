// This is an explicit placeholder. The UI may not claim live audio or DSP.
#[tauri::command]
fn audio_engine_status() -> &'static str {
    "not_implemented"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![audio_engine_status])
        .run(tauri::generate_context!())
        .expect("failed to start Rea Guitar NAM");
}
