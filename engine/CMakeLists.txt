cmake_minimum_required(VERSION 3.22)
project(VTTRIG_NAM_CORE LANGUAGES CXX)

# One pinned MIT NAM implementation for both Linux/JACK and Windows/offline.
# Building the upstream library is deliberately independent of audio backends.
include(FetchContent)
FetchContent_Declare(
  namcore
  GIT_REPOSITORY https://github.com/sdatkinson/NeuralAmpModelerCore.git
  GIT_TAG 0b3d3c97b0859a3a8c92a8628c4dd89a25eb5842
  GIT_SUBMODULES_RECURSE TRUE
  SOURCE_SUBDIR __vttrig_do_not_add_upstream_tools
)
FetchContent_MakeAvailable(namcore)

file(GLOB NAM_SOURCES CONFIGURE_DEPENDS
  "${namcore_SOURCE_DIR}/NAM/*.cpp"
  "${namcore_SOURCE_DIR}/NAM/*.c"
  "${namcore_SOURCE_DIR}/NAM/*/*.cpp"
)

# NAM architectures (Linear IR, WaveNet, etc.) register themselves through
# static initializers. When linked from a STATIC archive, the linker can
# discard translation units that only contain those registrations.
# An OBJECT library guarantees every parser is linked into each native host.
add_library(vttrig_nam_core OBJECT ${NAM_SOURCES})
target_compile_features(vttrig_nam_core PUBLIC cxx_std_20)
target_compile_definitions(vttrig_nam_core PUBLIC NAM_ENABLE_A2_FAST)
target_include_directories(vttrig_nam_core SYSTEM PUBLIC
  "${namcore_SOURCE_DIR}"
  "${namcore_SOURCE_DIR}/Dependencies/eigen"
  "${namcore_SOURCE_DIR}/Dependencies/nlohmann"
  "${namcore_SOURCE_DIR}/Dependencies/AudioDSPTools/dsp"
)

function(vttrig_warnings target)
  if(MSVC)
    target_compile_options(${target} PRIVATE /W4 /UNDEBUG)
  else()
    target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic -UNDEBUG)
  endif()
endfunction()

# Portable renderer. No JACK, ALSA, WASAPI or WebView headers are required.
add_executable(vttrig-nam-offline src/nam_offline.cpp)
target_compile_features(vttrig-nam-offline PRIVATE cxx_std_20)
target_link_libraries(vttrig-nam-offline PRIVATE vttrig_nam_core)
vttrig_warnings(vttrig-nam-offline)

add_executable(vttrig-nam-live src/nam_live.cpp)
target_compile_features(vttrig-nam-live PRIVATE cxx_std_20)
target_link_libraries(vttrig-nam-live PRIVATE vttrig_nam_core)
vttrig_warnings(vttrig-nam-live)

# JACK is a Linux-specific host adapter. Do not require it on Windows.
option(VTTRIG_BUILD_JACK "Build JACK adapter on Linux" ON)
if(CMAKE_SYSTEM_NAME STREQUAL "Linux" AND VTTRIG_BUILD_JACK)
  find_package(PkgConfig REQUIRED)
  pkg_check_modules(JACK REQUIRED IMPORTED_TARGET jack)
  add_executable(vttrig-nam-jack src/nam_jack.cpp)
  target_compile_features(vttrig-nam-jack PRIVATE cxx_std_20)
  target_link_libraries(vttrig-nam-jack PRIVATE vttrig_nam_core PkgConfig::JACK stdc++fs)
  vttrig_warnings(vttrig-nam-jack)
endif()

include(CTest)
if(BUILD_TESTING)
  add_executable(vttrig-chain-tests tests/chain_tests.cpp)
  target_compile_features(vttrig-chain-tests PRIVATE cxx_std_20)
  vttrig_warnings(vttrig-chain-tests)

  add_executable(vttrig-noise-gate-tests tests/noise_gate_tests.cpp)
  target_compile_features(vttrig-noise-gate-tests PRIVATE cxx_std_20)
  vttrig_warnings(vttrig-noise-gate-tests)

  add_executable(vttrig-compressor-tests tests/butter_comp2_tests.cpp)
  target_compile_features(vttrig-compressor-tests PRIVATE cxx_std_20)
  vttrig_warnings(vttrig-compressor-tests)

  add_executable(vttrig-sustain-tests tests/pressure_sustain_tests.cpp)
  target_compile_features(vttrig-sustain-tests PRIVATE cxx_std_20)
  vttrig_warnings(vttrig-sustain-tests)

  add_executable(vttrig-chorus-tests tests/daisy_chorus_tests.cpp)
  target_compile_features(vttrig-chorus-tests PRIVATE cxx_std_20)
  vttrig_warnings(vttrig-chorus-tests)

  add_executable(vttrig-delay-tests tests/classic_delay_tests.cpp)
  target_compile_features(vttrig-delay-tests PRIVATE cxx_std_20)
  vttrig_warnings(vttrig-delay-tests)

  add_executable(vttrig-reverb-tests tests/room_reverb_tests.cpp)
  target_compile_features(vttrig-reverb-tests PRIVATE cxx_std_20)
  vttrig_warnings(vttrig-reverb-tests)

  add_executable(vttrig-manifest-tests tests/manifest_tests.cpp)
  target_compile_features(vttrig-manifest-tests PRIVATE cxx_std_20)
  target_include_directories(vttrig-manifest-tests SYSTEM PRIVATE
    "${namcore_SOURCE_DIR}/Dependencies/nlohmann")
  vttrig_warnings(vttrig-manifest-tests)

  add_executable(vttrig-wav-tests tests/wav_tests.cpp)
  target_compile_features(vttrig-wav-tests PRIVATE cxx_std_20)
  vttrig_warnings(vttrig-wav-tests)

  add_test(NAME effect_chain_reorder_and_bypass COMMAND vttrig-chain-tests)
  add_test(NAME noise_gate_envelope_hold_and_bypass COMMAND vttrig-noise-gate-tests)
  add_test(NAME compressor_airwindows_smooth_and_bypass COMMAND vttrig-compressor-tests)
  add_test(NAME sustain_airwindows_pressure_envelope_and_bypass COMMAND vttrig-sustain-tests)
  add_test(NAME chorus_daisysp_modulation_delay_and_bypass COMMAND vttrig-chorus-tests)
  add_test(NAME delay_exact_samples_feedback_and_bypass COMMAND vttrig-delay-tests)
  add_test(NAME reverb_room_decay_size_mix_and_bypass COMMAND vttrig-reverb-tests)
  add_test(NAME ordered_manifest_validation COMMAND vttrig-manifest-tests)
  add_test(NAME portable_wav_read_write_render COMMAND vttrig-wav-tests)
  add_test(NAME portable_renderer_help COMMAND vttrig-nam-offline --help)
  add_test(NAME live_sidecar_help COMMAND vttrig-nam-live --help)
  find_package(Python3 COMPONENTS Interpreter REQUIRED)
  add_test(NAME live_sidecar_streaming_protocol
    COMMAND ${Python3_EXECUTABLE} "${CMAKE_CURRENT_SOURCE_DIR}/tests/live_protocol_test.py"
            "$<TARGET_FILE:vttrig-nam-live>"
            "${namcore_SOURCE_DIR}/example_models/wavenet.nam")
  set_tests_properties(live_sidecar_streaming_protocol PROPERTIES TIMEOUT 60)
  add_test(NAME native_offline_manifest_validation
    COMMAND vttrig-nam-offline --validate-chain-json
      "${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/ordered-chain.json")

  if(TARGET vttrig-nam-jack)
    add_test(NAME native_manifest_cli_validation
      COMMAND vttrig-nam-jack --validate-chain-json
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/ordered-chain.json")
    add_test(NAME nam_engine_help COMMAND vttrig-nam-jack --help)
  endif()
endif()
