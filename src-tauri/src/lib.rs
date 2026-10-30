mod audio;
mod live;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::State;

// The gate serialises DRY/WET operations on dedicated blocking workers.
// A cancellation flag can be set while a slow NAM handshake holds the gate.
// Neither the mutex nor a CPAL stream is used from an audio callback.
#[derive(Default)]
struct AudioCommandGate {
    control: Mutex<()>,
    // Monotonic generation avoids losing a cancellation before the worker starts.
    cancel_live_start: AtomicU64,
}

fn worker_error(error: tauri::Error) -> String {
    format!("Falha interna no worker de áudio: {error}")
}

#[tauri::command]
fn audio_engine_status() -> &'static str {
    "native_live_nam_ir_available"
}

#[tauri::command]
async fn audio_list_hosts() -> Result<Vec<audio::HostInfo>, String> {
    // JACK/ALSA host and device enumeration may block on the backend.
    tauri::async_runtime::spawn_blocking(audio::list_hosts)
        .await
        .map_err(worker_error)
}

#[tauri::command]
async fn audio_monitor_status(
    state: State<'_, Arc<audio::AudioState>>,
) -> Result<audio::MonitorStatus, String> {
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || audio::status(&state))
        .await
        .map_err(worker_error)?
}

#[tauri::command]
async fn audio_start_monitor(
    state: State<'_, Arc<audio::AudioState>>,
    live: State<'_, Arc<live::LiveState>>,
    gate: State<'_, Arc<AudioCommandGate>>,
    selection: audio::MonitorSelection,
) -> Result<(), String> {
    let state = Arc::clone(state.inner());
    let live = Arc::clone(live.inner());
    let gate = Arc::clone(gate.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = gate
            .control
            .lock()
            .map_err(|_| "Audio command gate unavailable")?;
        if live::status(&live)?.running {
            return Err("Desligue o NAM antes de iniciar o DRY.".into());
        }
        audio::start(&state, selection)
    })
    .await
    .map_err(worker_error)?
}

#[tauri::command]
async fn audio_stop_monitor(
    state: State<'_, Arc<audio::AudioState>>,
    gate: State<'_, Arc<AudioCommandGate>>,
) -> Result<(), String> {
    let state = Arc::clone(state.inner());
    let gate = Arc::clone(gate.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = gate
            .control
            .lock()
            .map_err(|_| "Audio command gate unavailable")?;
        audio::stop(&state)
    })
    .await
    .map_err(worker_error)?
}

#[tauri::command]
async fn audio_live_status(
    state: State<'_, Arc<live::LiveState>>,
) -> Result<live::LiveStatus, String> {
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || live::status(&state))
        .await
        .map_err(worker_error)?
}

#[tauri::command]
async fn audio_start_live(
    state: State<'_, Arc<live::LiveState>>,
    dry: State<'_, Arc<audio::AudioState>>,
    gate: State<'_, Arc<AudioCommandGate>>,
    selection: audio::MonitorSelection,
    chain_json: String,
) -> Result<(), String> {
    let state = Arc::clone(state.inner());
    let dry = Arc::clone(dry.inner());
    let gate = Arc::clone(gate.inner());
    let start_epoch = gate.cancel_live_start.load(Ordering::Acquire);
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = gate
            .control
            .lock()
            .map_err(|_| "Audio command gate unavailable")?;
        live::start(
            &state,
            &dry,
            selection,
            chain_json,
            &gate.cancel_live_start,
            start_epoch,
        )
    })
    .await
    .map_err(worker_error)?
}

#[tauri::command]
fn audio_cancel_live_start(gate: State<'_, Arc<AudioCommandGate>>) {
    // Always immediate even if a model is still loading and owns the mutex.
    gate.cancel_live_start.fetch_add(1, Ordering::AcqRel);
}

#[tauri::command]
async fn audio_stop_live(
    state: State<'_, Arc<live::LiveState>>,
    gate: State<'_, Arc<AudioCommandGate>>,
) -> Result<(), String> {
    let state = Arc::clone(state.inner());
    let gate = Arc::clone(gate.inner());
    // Interrupt an in-flight handshake *before* waiting for the serial gate.
    gate.cancel_live_start.fetch_add(1, Ordering::AcqRel);
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = gate
            .control
            .lock()
            .map_err(|_| "Audio command gate unavailable")?;
        live::stop(&state)
    })
    .await
    .map_err(worker_error)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn cancellation_can_be_signalled_without_waiting_for_the_control_mutex() {
        let gate = Arc::new(AudioCommandGate::default());
        let locked = gate.control.lock().unwrap();
        let flag = Arc::clone(&gate);
        let start = Instant::now();
        std::thread::spawn(move || {
            flag.cancel_live_start.store(true, Ordering::Release);
        })
        .join()
        .unwrap();
        assert_eq!(gate.cancel_live_start.load(Ordering::Acquire), 1);
        // A later start reads generation 1, never a stale cancellation.
        assert_eq!(gate.cancel_live_start.load(Ordering::Acquire), 1);
        assert!(start.elapsed() < Duration::from_secs(1));
        drop(locked);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(audio::AudioState::default()))
        .manage(Arc::new(live::LiveState::default()))
        .manage(Arc::new(AudioCommandGate::default()))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            audio_engine_status,
            audio_list_hosts,
            audio_monitor_status,
            audio_start_monitor,
            audio_stop_monitor,
            audio_live_status,
            audio_start_live,
            audio_cancel_live_start,
            audio_stop_live,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start VTTRIG");
}
