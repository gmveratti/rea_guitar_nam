mod audio;

use tauri::State;

// The NAM/IR DSP core is not attached to this live I/O prototype yet.
#[tauri::command]
fn audio_engine_status() -> &'static str {
    "dry_monitor_available_no_nam_dsp"
}

#[tauri::command]
fn audio_list_hosts() -> Vec<audio::HostInfo> {
    audio::list_hosts()
}

#[tauri::command]
fn audio_monitor_status(state: State<'_, audio::AudioState>) -> Result<audio::MonitorStatus, String> {
    audio::status(&state)
}

#[tauri::command]
fn audio_start_monitor(
    state: State<'_, audio::AudioState>,
    selection: audio::MonitorSelection,
) -> Result<(), String> {
    audio::start(&state, selection)
}

#[tauri::command]
fn audio_stop_monitor(state: State<'_, audio::AudioState>) -> Result<(), String> {
    audio::stop(&state)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(audio::AudioState::default())
        .invoke_handler(tauri::generate_handler![
            audio_engine_status,
            audio_list_hosts,
            audio_monitor_status,
            audio_start_monitor,
            audio_stop_monitor,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start VTTRIG");
}
