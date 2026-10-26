mod audio;
mod live;

use tauri::State;

// Live NAM/IR runs in an isolated C++ sidecar, while dry monitoring is unchanged.
#[tauri::command]
fn audio_engine_status() -> &'static str {
    "native_live_nam_ir_available"
}

#[tauri::command]
fn audio_list_hosts() -> Vec<audio::HostInfo> {
    audio::list_hosts()
}

#[tauri::command]
fn audio_monitor_status(
    state: State<'_, audio::AudioState>,
) -> Result<audio::MonitorStatus, String> {
    audio::status(&state)
}

#[tauri::command]
fn audio_start_monitor(
    state: State<'_, audio::AudioState>,
    live: State<'_, live::LiveState>,
    selection: audio::MonitorSelection,
) -> Result<(), String> {
    if live::status(&live)?.running {
        return Err("Desligue o NAM/IR antes de iniciar o DRY.".into());
    }
    audio::start(&state, selection)
}

#[tauri::command]
fn audio_stop_monitor(state: State<'_, audio::AudioState>) -> Result<(), String> {
    audio::stop(&state)
}

#[tauri::command]
fn audio_live_status(state: State<'_, live::LiveState>) -> Result<live::LiveStatus, String> {
    live::status(&state)
}

#[tauri::command]
fn audio_start_live(
    state: State<'_, live::LiveState>,
    dry: State<'_, audio::AudioState>,
    selection: audio::MonitorSelection,
    chain_json: String,
) -> Result<(), String> {
    live::start(&state, &dry, selection, chain_json)
}

#[tauri::command]
fn audio_stop_live(state: State<'_, live::LiveState>) -> Result<(), String> {
    live::stop(&state)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(audio::AudioState::default())
        .manage(live::LiveState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            audio_engine_status,
            audio_list_hosts,
            audio_monitor_status,
            audio_start_monitor,
            audio_stop_monitor,
            audio_live_status,
            audio_start_live,
            audio_stop_live,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start VTTRIG");
}
