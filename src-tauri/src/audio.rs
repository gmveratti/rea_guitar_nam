//! Native device selection and opt-in, attenuated DRY monitoring.
//!
//! No NAM, IR or pedal DSP is attached here. Input and output callbacks
//! communicate via a bounded lock-free single-producer/single-consumer ring.
//! They never allocate, lock, call Tauri or touch the filesystem.
//!
//! Windows builds include WASAPI and ASIO; Linux includes ALSA and JACK.
//! ASIO needs an installed driver; JACK/PipeWire-JACK needs a running server.
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{
    BufferSize, FromSample, Sample, SampleFormat, SizedSample, Stream, StreamConfig,
    SupportedBufferSize, SupportedStreamConfigRange,
};
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
#[derive(Clone, Deserialize, Serialize)]
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
    pub selection: Option<MonitorSelection>,
}

pub struct MonitorStreams {
    _input: Stream,
    _output: Stream,
    faults: Arc<AtomicU8>,
    selection: MonitorSelection,
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
        selection: guard.as_ref().map(|s| s.selection.clone()),
    })
}

// Never offer ALSA's null PCM as if it were a guitar interface.
fn is_silent_alsa_endpoint(host_id: &str, name: &str) -> bool {
    if !host_id.eq_ignore_ascii_case("alsa") {
        return false;
    }
    let normalized = name.trim().to_ascii_lowercase();
    normalized == "null"
        || normalized.contains("discard all samples")
        || normalized.contains("generate zero samples")
        || normalized.contains("null pcm")
}

fn host_priority(host: &HostInfo) -> u8 {
    let ready = host.inputs.iter().any(|d| d.supports_monitor)
        && host.outputs.iter().any(|d| d.supports_monitor);
    match (host.id.as_str(), ready) {
        ("jack" | "asio", true) => 0, // prefer native low-latency guitar backends
        (_, true) => 1,
        _ => 2,
    }
}

fn supported_pcm_format(format: SampleFormat) -> bool {
    matches!(
        format,
        SampleFormat::F32
            | SampleFormat::F64
            | SampleFormat::I16
            | SampleFormat::I24
            | SampleFormat::I32
            | SampleFormat::I8
            | SampleFormat::I64
            | SampleFormat::U8
            | SampleFormat::U16
            | SampleFormat::U24
            | SampleFormat::U32
            | SampleFormat::U64
    )
}

fn supports_48k(range: &SupportedStreamConfigRange) -> bool {
    supported_pcm_format(range.sample_format())
        && range.min_sample_rate() <= RATE
        && range.max_sample_rate() >= RATE
        && range.channels() > 0
}

fn range_priority(range: &SupportedStreamConfigRange) -> (u8, u8) {
    (
        if range.channels() == 2 { 0 } else { 1 },
        if range.sample_format() == SampleFormat::F32 {
            0
        } else {
            1
        },
    )
}

fn supports_backend_format(format: SampleFormat, host_id: &str) -> bool {
    if host_id.eq_ignore_ascii_case("asio") {
        // CPAL 0.17's ASIO check_config accepts these formats only, even though
        // its native format enum also describes Float64 and DSD variants.
        matches!(
            format,
            SampleFormat::I16 | SampleFormat::I24 | SampleFormat::I32 | SampleFormat::F32
        )
    } else {
        supported_pcm_format(format)
    }
}

fn supports_48k_pcm(device: &cpal::Device, input: bool, host_id: &str) -> Option<u16> {
    let configs = if input {
        device.supported_input_configs().ok()?.collect::<Vec<_>>()
    } else {
        device.supported_output_configs().ok()?.collect::<Vec<_>>()
    };
    configs
        .into_iter()
        .filter(supports_48k)
        .filter(|range| supports_backend_format(range.sample_format(), host_id))
        // JACK advertises 1, 2, 4... channels in that order. Prefer stereo
        // output (and two possible guitar inputs) over JACK's first mono range.
        .min_by_key(range_priority)
        .map(|range| range.channels())
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
                let supported = supports_48k_pcm(&device, input, &host.id().to_string());
                let name = device
                    .description()
                    .map(|d| d.name().to_string())
                    .unwrap_or_else(|_| format!("Dispositivo {index}"));
                let silent = is_silent_alsa_endpoint(&host.id().to_string(), &name);
                DeviceInfo {
                    index,
                    name,
                    channels: supported.unwrap_or(0),
                    supports_monitor: supported.is_some() && !silent,
                }
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

pub fn list_hosts() -> Vec<HostInfo> {
    let mut hosts: Vec<_> = cpal::available_hosts()
        .into_iter()
        .filter_map(|id| {
            let host = cpal::host_from_id(id).ok()?;
            Some(HostInfo {
                id: id.to_string().to_lowercase(),
                inputs: devices(&host, true),
                outputs: devices(&host, false),
            })
        })
        .collect();
    hosts.sort_by_key(host_priority);
    hosts
}

pub(crate) fn validate_buffer(frames: u32) -> Result<(), String> {
    if [64, 128, 256, 512, 1024].contains(&frames) {
        Ok(())
    } else {
        Err("Selecione um buffer de 64, 128, 256, 512 ou 1024 samples.".into())
    }
}

pub(crate) struct ConfiguredDevice {
    pub device: cpal::Device,
    pub config: StreamConfig,
    pub sample_format: SampleFormat,
}

pub(crate) fn choose_device(
    host: &cpal::Host,
    input: bool,
    index: usize,
    frames: u32,
) -> Result<ConfiguredDevice, String> {
    let mut iterator = if input {
        host.input_devices().map_err(|e| e.to_string())?
    } else {
        host.output_devices().map_err(|e| e.to_string())?
    };
    let device = iterator
        .nth(index)
        .ok_or("Dispositivo desconectado. Atualize a lista.")?;
    configure_device(host, device, input, frames)
}

fn configure_device(
    host: &cpal::Host,
    device: cpal::Device,
    input: bool,
    frames: u32,
) -> Result<ConfiguredDevice, String> {
    let name = device
        .description()
        .map(|d| d.name().to_string())
        .unwrap_or_default();
    if is_silent_alsa_endpoint(&host.id().to_string(), &name) {
        return Err("A saída/entrada ALSA 'null' não transporta áudio. Selecione JACK ou uma interface real.".into());
    }
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
        .filter(supports_48k)
        .filter(|range| supports_backend_format(range.sample_format(), &host.id().to_string()))
        .min_by_key(range_priority)
        .ok_or("Este dispositivo não oferece áudio PCM a 48 kHz neste backend.")?;

    // JACK owns its server buffer size. Requesting Fixed(128) while the JACK
    // server is at 256 will fail in CPAL >= 0.17. Never change server settings.
    let is_jack = host.id().to_string().eq_ignore_ascii_case("jack");
    if !is_jack {
        if let SupportedBufferSize::Range { min, max } = range.buffer_size() {
            if frames < *min || frames > *max {
                return Err(format!(
                    "Buffer indisponível: o dispositivo aceita {min} a {max} frames."
                ));
            }
        }
    }
    Ok(ConfiguredDevice {
        device,
        sample_format: range.sample_format(),
        config: StreamConfig {
            channels: range.channels(),
            sample_rate: RATE,
            buffer_size: if is_jack {
                BufferSize::Default
            } else {
                BufferSize::Fixed(frames)
            },
        },
    })
}

pub(crate) fn choose_duplex_devices(
    host: &cpal::Host,
    input_index: usize,
    output_index: usize,
    frames: u32,
) -> Result<(ConfiguredDevice, ConfiguredDevice), String> {
    if host.id().to_string().eq_ignore_ascii_case("asio") {
        // Resolve and DROP the output handle before retaining an input handle.
        // ASIO can load one driver globally: keeping the input alive while
        // enumerating outputs hides other drivers and changes their indices.
        let output_name = {
            let device = host
                .output_devices()
                .map_err(|e| e.to_string())?
                .nth(output_index)
                .ok_or("Dispositivo desconectado. Atualize a lista.")?;
            device
                .description()
                .map_err(|e| e.to_string())?
                .name()
                .to_owned()
        };
        let input = choose_device(host, true, input_index, frames)?;
        let input_name = input.device.description().map_err(|e| e.to_string())?;
        validate_asio_pair(input_name.name(), &output_name)?;
        // Configure the same driver's output without a second enumeration.
        // Cloning also preserves CPAL's shared ASIO stream state for duplex.
        let output = configure_device(host, input.device.clone(), false, frames)?;
        return Ok((input, output));
    }
    let input = choose_device(host, true, input_index, frames)?;
    let output = choose_device(host, false, output_index, frames)?;
    Ok((input, output))
}

fn validate_asio_pair(input: &str, output: &str) -> Result<(), String> {
    if input == output {
        Ok(())
    } else {
        Err("ASIO exige entrada e saída do mesmo driver/interface.".into())
    }
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
pub(crate) fn selected_mono_sample<T: Sample>(frame: &[T], channel: usize) -> f32
where
    f32: FromSample<T>,
{
    let sample = frame
        .get(channel)
        .map(|value| value.to_sample::<f32>())
        .unwrap_or(0.0);
    if sample.is_finite() {
        sample
    } else {
        0.0
    }
}

// Conversion runs sample-by-sample on preallocated device buffers. No temporary
// Vec, lock, allocation or logging is introduced into either audio callback.
fn receive_input<T: Sample>(
    data: &[T],
    channels: usize,
    channel: usize,
    receive: &mut impl FnMut(f32),
) where
    f32: FromSample<T>,
{
    for frame in data.chunks(channels) {
        receive(selected_mono_sample(frame, channel));
    }
}

fn fill_output<T: Sample + FromSample<f32>>(
    data: &mut [T],
    channels: usize,
    next_sample: &mut impl FnMut() -> f32,
) {
    for frame in data.chunks_mut(channels) {
        let sample = next_sample();
        let sample = if sample.is_finite() {
            sample.clamp(-1.0, 1.0)
        } else {
            0.0
        };
        frame.fill(sample.to_sample::<T>());
    }
}

fn typed_input_stream<T, D, E>(
    selected: &ConfiguredDevice,
    channel: usize,
    mut receive: D,
    error: E,
) -> Result<Stream, cpal::BuildStreamError>
where
    T: SizedSample,
    f32: FromSample<T>,
    D: FnMut(f32) + Send + 'static,
    E: FnMut(cpal::StreamError) + Send + 'static,
{
    let channels = usize::from(selected.config.channels);
    selected.device.build_input_stream(
        &selected.config,
        move |data: &[T], _| receive_input(data, channels, channel, &mut receive),
        error,
        None,
    )
}

fn typed_output_stream<T, D, E>(
    selected: &ConfiguredDevice,
    mut next_sample: D,
    error: E,
) -> Result<Stream, cpal::BuildStreamError>
where
    T: SizedSample + FromSample<f32>,
    D: FnMut() -> f32 + Send + 'static,
    E: FnMut(cpal::StreamError) + Send + 'static,
{
    let channels = usize::from(selected.config.channels);
    selected.device.build_output_stream(
        &selected.config,
        move |data: &mut [T], _| fill_output(data, channels, &mut next_sample),
        error,
        None,
    )
}

pub(crate) fn build_input_stream<D, E>(
    selected: &ConfiguredDevice,
    channel: usize,
    receive: D,
    error: E,
) -> Result<Stream, cpal::BuildStreamError>
where
    D: FnMut(f32) + Send + 'static,
    E: FnMut(cpal::StreamError) + Send + 'static,
{
    macro_rules! dispatch {
        ($($format:ident => $sample:ty),+ $(,)?) => {
            match selected.sample_format {
                $(SampleFormat::$format => typed_input_stream::<$sample, _, _>(selected, channel, receive, error),)+
                _ => Err(cpal::BuildStreamError::StreamConfigNotSupported),
            }
        };
    }
    dispatch!(F32 => f32, F64 => f64, I8 => i8, I16 => i16, I24 => cpal::I24,
              I32 => i32, I64 => i64, U8 => u8, U16 => u16, U24 => cpal::U24,
              U32 => u32, U64 => u64)
}

pub(crate) fn build_output_stream<D, E>(
    selected: &ConfiguredDevice,
    next_sample: D,
    error: E,
) -> Result<Stream, cpal::BuildStreamError>
where
    D: FnMut() -> f32 + Send + 'static,
    E: FnMut(cpal::StreamError) + Send + 'static,
{
    macro_rules! dispatch {
        ($($format:ident => $sample:ty),+ $(,)?) => {
            match selected.sample_format {
                $(SampleFormat::$format => typed_output_stream::<$sample, _, _>(selected, next_sample, error),)+
                _ => Err(cpal::BuildStreamError::StreamConfigNotSupported),
            }
        };
    }
    dispatch!(F32 => f32, F64 => f64, I8 => i8, I16 => i16, I24 => cpal::I24,
              I32 => i32, I64 => i64, U8 => u8, U16 => u16, U24 => cpal::U24,
              U32 => u32, U64 => u64)
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
    let (input, output) = choose_duplex_devices(
        &host,
        selection.input_index,
        selection.output_index,
        selection.buffer_frames,
    )?;
    validate_input_channel(selection.input_channel, input.config.channels)?;
    // Lock is used only on the control thread, never on an audio callback.
    let mut guard = state
        .streams
        .lock()
        .map_err(|_| "Audio state unavailable")?;
    if guard.is_some() {
        return Err("O monitor já está ligado. Desligue antes de alterar o dispositivo.".into());
    }
    let (mut producer, mut consumer) = RingBuffer::<f32>::new(RING_FRAMES);
    let input_channel = selection.input_channel;
    let faults = Arc::new(AtomicU8::new(0));
    let input_error = Arc::clone(&faults);
    let output_error = Arc::clone(&faults);
    let output_silence = Arc::clone(&faults);
    // Enqueue selected mono channel. Full ring drops frames; no latency guarantee.
    let input_stream = build_input_stream(
        &input,
        input_channel,
        move |sample| {
            let _ = producer.push(sample);
        },
        move |_error| {
            input_error.fetch_or(INPUT_FAULT, Ordering::Relaxed);
        },
    )
    .map_err(|e| format!("Não foi possível abrir a entrada: {e}"))?;

    let output_stream = build_output_stream(
        &output,
        move || {
            if output_silence.load(Ordering::Relaxed) != 0 {
                0.0
            } else {
                safe_sample(consumer.pop().unwrap_or(0.0))
            }
        },
        move |_error| {
            output_error.fetch_or(OUTPUT_FAULT, Ordering::Relaxed);
        },
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
        selection,
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
    fn null_alsa_is_never_offered_as_working_guitar_io() {
        assert!(is_silent_alsa_endpoint(
            "alsa",
            "Discard all samples (playback) or generate zero samples (capture)"
        ));
        assert!(is_silent_alsa_endpoint("ALSA", "null"));
        assert!(!is_silent_alsa_endpoint("jack", "cpal_client_in"));
        assert!(!is_silent_alsa_endpoint("alsa", "HD-II USB Audio"));
        let active = |id: &str, ok: bool| HostInfo {
            id: id.into(),
            inputs: vec![DeviceInfo {
                index: 0,
                name: "input".into(),
                channels: 2,
                supports_monitor: ok,
            }],
            outputs: vec![DeviceInfo {
                index: 1,
                name: "output".into(),
                channels: 2,
                supports_monitor: ok,
            }],
        };
        assert!(host_priority(&active("jack", true)) < host_priority(&active("alsa", true)));
        assert!(host_priority(&active("jack", false)) > host_priority(&active("alsa", true)));
        assert!(host_priority(&active("asio", true)) < host_priority(&active("wasapi", true)));
        assert!(host_priority(&active("asio", false)) > host_priority(&active("wasapi", true)));
    }
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
    fn integer_native_configs_are_available_at_48k_without_f32() {
        for format in [
            SampleFormat::I16,
            SampleFormat::I24,
            SampleFormat::I32,
            SampleFormat::F32,
            SampleFormat::F64,
            SampleFormat::U16,
        ] {
            let range = SupportedStreamConfigRange::new(
                2,
                44_100,
                96_000,
                SupportedBufferSize::Unknown,
                format,
            );
            assert!(supports_48k(&range), "Rejected native PCM: {format}");
        }
        let dsd = SupportedStreamConfigRange::new(
            2,
            RATE,
            RATE,
            SupportedBufferSize::Unknown,
            SampleFormat::DsdU8,
        );
        assert!(!supports_48k(&dsd));
        assert!(supports_backend_format(SampleFormat::I24, "asio"));
        assert!(!supports_backend_format(SampleFormat::F64, "asio"));
        assert!(supports_backend_format(SampleFormat::F64, "wasapi"));
        let wrong_rate = SupportedStreamConfigRange::new(
            2,
            44_100,
            44_100,
            SupportedBufferSize::Unknown,
            SampleFormat::I32,
        );
        assert!(!supports_48k(&wrong_rate));
    }

    #[test]
    fn native_integer_callbacks_convert_normalized_audio_and_fan_out() {
        fn roundtrip<T>()
        where
            T: Sample + FromSample<f32>,
            f32: FromSample<T>,
        {
            let mut block = [T::EQUILIBRIUM; 12];
            let mut source = [-0.5_f32, 0.0, 0.5].into_iter();
            fill_output(&mut block, 4, &mut || source.next().unwrap());
            for (frame, expected) in block.chunks(4).zip([-0.5_f32, 0.0, 0.5]) {
                for channel in frame {
                    assert!((channel.to_sample::<f32>() - expected).abs() < 0.0001);
                }
            }
            let mut converted = Vec::new();
            receive_input(&block, 4, 2, &mut |sample| converted.push(sample));
            assert_eq!(converted, vec![-0.5, 0.0, 0.5]);
        }
        roundtrip::<i16>();
        roundtrip::<cpal::I24>();
        roundtrip::<i32>();
        roundtrip::<f32>();
        roundtrip::<f64>();
        roundtrip::<u16>();
        roundtrip::<cpal::U24>();
    }

    #[test]
    fn integer_input_channel_selection_preserves_sign_and_floating_faults_are_silent() {
        assert_eq!(selected_mono_sample(&[i16::MIN, 16_384], 1), 0.5);
        assert_eq!(selected_mono_sample(&[i32::MIN, 0], 0), -1.0);
        assert_eq!(
            selected_mono_sample(&[cpal::I24::new(-4_194_304).unwrap()], 0),
            -0.5
        );
        assert_eq!(selected_mono_sample(&[f64::NAN], 0), 0.0);
        assert_eq!(selected_mono_sample(&[f64::INFINITY], 0), 0.0);
        assert_eq!(selected_mono_sample(&[0_i32], 1), 0.0);
    }

    #[test]
    fn output_conversion_silences_nonfinite_samples_and_centers_unsigned_pcm() {
        let mut output = [0_u16; 6];
        let mut source = [f32::NAN, f32::INFINITY, -f32::INFINITY].into_iter();
        fill_output(&mut output, 2, &mut || source.next().unwrap());
        assert_eq!(output, [32_768; 6]);
        let mut clipped = [0_i16; 2];
        let mut source = [-2.0_f32, 2.0].into_iter();
        fill_output(&mut clipped, 1, &mut || source.next().unwrap());
        assert_eq!(clipped, [i16::MIN, i16::MAX]);
    }

    #[test]
    fn asio_duplex_rejects_two_separate_drivers() {
        assert!(validate_asio_pair("USB ASIO", "USB ASIO").is_ok());
        assert!(validate_asio_pair("USB ASIO", "ASIO4ALL").is_err());
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
