//! Native device selection and opt-in, attenuated DRY monitoring.
//!
//! No NAM, IR or pedal DSP is attached here. Input and output callbacks
//! communicate via a bounded lock-free single-producer/single-consumer ring.
//! They never allocate, lock, call Tauri or touch the filesystem.
//!
//! WASAPI (Windows) and ALSA (Linux) are built by default. ASIO / JACK only
//! appear when both their optional CPAL feature and system drivers are present.
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, SampleFormat, Stream, StreamConfig, SupportedBufferSize};
use rtrb::RingBuffer;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};

const RATE: u32 = 48_000;
const RING_FRAMES: usize = 16_384;
const SAFE_GAIN: f32 = 0.12;

const INPUT_FAULT: u8 = 1;
const OUTPUT_FAULT: u8 = 2;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub index: usize,
    pub name: String,
    pub channels: u16,
    pub supports_monitor: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    pub id: String,
    pub inputs: Vec<DeviceInfo>,
    pub outputs: Vec<DeviceInfo>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorSelection {
    pub host_id: String,
    pub input_index: usize,
    pub output_index: usize,
    pub buffer_frames: u32,
    #[serde(default)]
    pub input_channel: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorStatus {
    pub running: bool,
    pub failed: bool,
    pub input_failed: bool,
    pub output_failed: bool,
    pub mode: &'static str,
}

pub struct MonitorStreams {
    _input: Stream,
    _output: Stream,
    faults: Arc<AtomicU8>,
}
#[derive(Default)]
pub struct AudioState {
    streams: Mutex<Option<MonitorStreams>>,
}

pub fn status(state: &AudioState) -> Result<MonitorStatus, String> {
    let guard = state
        .streams
        .lock()
        .map_err(|_| "Audio state unavailable")?;
    let faults = guard
        .as_ref()
        .map_or(0, |s| s.faults.load(Ordering::Relaxed));
    Ok(MonitorStatus {
        running: guard.is_some(),
        failed: faults != 0,
        input_failed: faults & INPUT_FAULT != 0,
        output_failed: faults & OUTPUT_FAULT != 0,
        mode: "dry_monitor_only_no_nam_dsp",
    })
}

fn supports_48k_float(device: &cpal::Device, input: bool) -> Option<u16> {
    let configs = if input {
        device.supported_input_configs().ok()?.collect::<Vec<_>>()
    } else {
        device.supported_output_configs().ok()?.collect::<Vec<_>>()
    };
    configs
        .into_iter()
        .filter(|range| {
            range.sample_format() == SampleFormat::F32
                && range.min_sample_rate() <= RATE
                && range.max_sample_rate() >= RATE
                && range.channels() > 0
        })
        .map(|range| range.channels())
        .next()
}

fn devices(host: &cpal::Host, input: bool) -> Vec<DeviceInfo> {
    let iterator = if input {
        host.input_devices()
    } else {
        host.output_devices()
    };
    match iterator {
        Ok(devices) => devices
            .enumerate()
            .map(|(index, device)| {
                let supported = supports_48k_float(&device, input);
                DeviceInfo {
                    index,
                    name: device
                        .description()
                        .map(|d| d.name().to_string())
                        .unwrap_or_else(|_| format!("Dispositivo {index}")),
                    channels: supported.unwrap_or(0),
                    supports_monitor: supported.is_some(),
                }
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

pub fn list_hosts() -> Vec<HostInfo> {
    cpal::available_hosts()
        .into_iter()
        .filter_map(|id| {
            let host = cpal::host_from_id(id).ok()?;
            Some(HostInfo {
                id: id.to_string().to_lowercase(),
                inputs: devices(&host, true),
                outputs: devices(&host, false),
            })
        })
        .collect()
}

pub(crate) fn validate_buffer(frames: u32) -> Result<(), String> {
    if [64, 128, 256, 512, 1024].contains(&frames) {
        Ok(())
    } else {
        Err("Selecione um buffer de 64, 128, 256, 512 ou 1024 samples.".into())
    }
}

pub(crate) fn choose_device(
    host: &cpal::Host,
    input: bool,
    index: usize,
    frames: u32,
) -> Result<(cpal::Device, StreamConfig), String> {
    let mut iterator = if input {
        host.input_devices().map_err(|e| e.to_string())?
    } else {
        host.output_devices().map_err(|e| e.to_string())?
    };
    let device = iterator
        .nth(index)
        .ok_or("Dispositivo desconectado. Atualize a lista.")?;
    let ranges = if input {
        device
            .supported_input_configs()
            .map_err(|e| e.to_string())?
            .collect::<Vec<_>>()
    } else {
        device
            .supported_output_configs()
            .map_err(|e| e.to_string())?
            .collect::<Vec<_>>()
    };
    let range = ranges
        .into_iter()
        .find(|range| {
            range.sample_format() == SampleFormat::F32
                && range.min_sample_rate() <= RATE
                && range.max_sample_rate() >= RATE
                && range.channels() > 0
        })
        .ok_or("Este dispositivo não oferece F32 a 48 kHz neste backend.")?;

    if let SupportedBufferSize::Range { min, max } = range.buffer_size() {
        if frames < *min || frames > *max {
            return Err(format!(
                "Buffer indisponível: o dispositivo aceita {min} a {max} frames."
            ));
        }
    }
    Ok((
        device,
        StreamConfig {
            channels: range.channels(),
            sample_rate: RATE,
            buffer_size: BufferSize::Fixed(frames),
        },
    ))
}

pub(crate) fn validate_input_channel(channel: usize, channels: u16) -> Result<(), String> {
    if channel < usize::from(channels) {
        Ok(())
    } else {
        Err(format!(
            "Canal de entrada {} indisponível: o dispositivo tem {} canal(is).",
            channel.saturating_add(1),
            channels
        ))
    }
}

// Called from the native callback; no allocation, locking or logging.
pub(crate) fn selected_mono_sample(frame: &[f32], channel: usize) -> f32 {
    let sample = frame.get(channel).copied().unwrap_or(0.0);
    if sample.is_finite() {
        sample
    } else {
        0.0
    }
}

fn safe_sample(value: f32) -> f32 {
    if value.is_finite() {
        (value * SAFE_GAIN).clamp(-0.8, 0.8)
    } else {
        0.0
    }
}

pub fn start(state: &AudioState, selection: MonitorSelection) -> Result<(), String> {
    validate_buffer(selection.buffer_frames)?;
    let id = cpal::HostId::from_str(&selection.host_id)
        .map_err(|_| "Backend de áudio não reconhecido".to_owned())?;
    if !cpal::available_hosts().contains(&id) {
        return Err("Backend não está disponível neste computador/build.".into());
    }
    let host = cpal::host_from_id(id).map_err(|e| e.to_string())?;
    let (input, input_config) =
        choose_device(&host, true, selection.input_index, selection.buffer_frames)?;
    let (output, output_config) = choose_device(
        &host,
        false,
        selection.output_index,
        selection.buffer_frames,
    )?;
    validate_input_channel(selection.input_channel, input_config.channels)?;
    // Lock is used only on the control thread, never on an audio callback.
    let mut guard = state
        .streams
        .lock()
        .map_err(|_| "Audio state unavailable")?;
    if guard.is_some() {
        return Err("O monitor já está ligado. Desligue antes de alterar o dispositivo.".into());
    }
    let (mut producer, mut consumer) = RingBuffer::<f32>::new(RING_FRAMES);
    let input_channels = usize::from(input_config.channels);
    let input_channel = selection.input_channel;
    let output_channels = usize::from(output_config.channels);
    let faults = Arc::new(AtomicU8::new(0));
    let input_error = Arc::clone(&faults);
    let output_error = Arc::clone(&faults);
    let output_silence = Arc::clone(&faults);
    // Enqueue selected mono channel. Full ring drops frames; no latency guarantee.
    let input_stream = input
        .build_input_stream(
            &input_config,
            move |data: &[f32], _| {
                for frame in data.chunks(input_channels) {
                    let _ = producer.push(selected_mono_sample(frame, input_channel));
                }
            },
            move |_error| {
                input_error.fetch_or(INPUT_FAULT, Ordering::Relaxed);
            },
            None,
        )
        .map_err(|e| format!("Não foi possível abrir a entrada: {e}"))?;

    let output_stream = output
        .build_output_stream(
            &output_config,
            move |data: &mut [f32], _| {
                for frame in data.chunks_mut(output_channels) {
                    let sample = if output_silence.load(Ordering::Relaxed) != 0 {
                        0.0
                    } else {
                        safe_sample(consumer.pop().unwrap_or(0.0))
                    };
                    for channel in frame {
                        *channel = sample;
                    }
                }
            },
            move |_error| {
                output_error.fetch_or(OUTPUT_FAULT, Ordering::Relaxed);
            },
            None,
        )
        .map_err(|e| format!("Não foi possível abrir a saída: {e}"))?;
    // No autostart. This only executes following an explicit UI click.
    output_stream
        .play()
        .map_err(|e| format!("Não foi possível iniciar a saída: {e}"))?;
    input_stream
        .play()
        .map_err(|e| format!("Não foi possível iniciar a entrada: {e}"))?;
    *guard = Some(MonitorStreams {
        _input: input_stream,
        _output: output_stream,
        faults,
    });
    Ok(())
}

pub fn stop(state: &AudioState) -> Result<(), String> {
    let mut guard = state
        .streams
        .lock()
        .map_err(|_| "Audio state unavailable")?;
    *guard = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn guitar_channel_routes_correctly_and_rejects_invalid_indices() {
        assert!(validate_input_channel(0, 2).is_ok());
        assert!(validate_input_channel(1, 2).is_ok());
        assert!(validate_input_channel(2, 2).is_err());
        assert!(validate_input_channel(0, 0).is_err());
        assert_eq!(selected_mono_sample(&[0.1, 0.75], 1), 0.75);
        assert_eq!(selected_mono_sample(&[0.1, 0.75], 0), 0.1);
        assert_eq!(selected_mono_sample(&[0.1], 1), 0.0);
        assert_eq!(selected_mono_sample(&[f32::NAN, 0.3], 0), 0.0);
    }
    #[test]
    fn independent_failure_bits_identify_input_and_output() {
        let faults = AtomicU8::new(0);
        assert_eq!(faults.load(Ordering::Relaxed), 0);
        faults.fetch_or(INPUT_FAULT, Ordering::Relaxed);
        assert_ne!(faults.load(Ordering::Relaxed) & INPUT_FAULT, 0);
        assert_eq!(faults.load(Ordering::Relaxed) & OUTPUT_FAULT, 0);
        faults.fetch_or(OUTPUT_FAULT, Ordering::Relaxed);
        assert_eq!(faults.load(Ordering::Relaxed), INPUT_FAULT | OUTPUT_FAULT);
    }
    #[test]
    fn deserializes_legacy_and_explicit_channel_selections() {
        let base = r#"{"hostId":"wasapi","inputIndex":0,"outputIndex":0,"bufferFrames":256}"#;
        let legacy: MonitorSelection = serde_json::from_str(base).unwrap();
        assert_eq!(legacy.input_channel, 0);
        let selected: MonitorSelection = serde_json::from_str(
            r#"{"hostId":"wasapi","inputIndex":0,"outputIndex":0,"bufferFrames":256,"inputChannel":1}"#,
        ).unwrap();
        assert_eq!(selected.input_channel, 1);
    }
    #[test]
    fn only_safe_buffer_options() {
        assert!(validate_buffer(64).is_ok());
        assert!(validate_buffer(128).is_ok());
        assert!(validate_buffer(1024).is_ok());
        assert!(validate_buffer(0).is_err());
        assert!(validate_buffer(8192).is_err());
    }
    #[test]
    fn monitoring_sanitizes_and_limits_output() {
        assert!((safe_sample(1.0) - 0.12).abs() < 1e-6);
        assert_eq!(safe_sample(f32::NAN), 0.0);
        assert_eq!(safe_sample(f32::INFINITY), 0.0);
        assert_eq!(safe_sample(9999.0), 0.8);
    }
    #[test]
    fn inactive_state_never_implies_nam_processing() {
        let state = AudioState::default();
        let value = status(&state).unwrap();
        assert!(!value.running);
        assert_eq!(value.mode, "dry_monitor_only_no_nam_dsp");
    }
}
