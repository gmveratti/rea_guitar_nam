cmake_minimum_required(VERSION 3.22)
project(VTTRIG_NAM_JACK LANGUAGES CXX)

# Linux JACK proof-of-concept. Build independently of the Tauri WebView.
# Pin the MIT NAM core to a reviewed upstream commit (v0.6.0).
include(FetchContent)
FetchContent_Declare(
  namcore
  GIT_REPOSITORY https://github.com/sdatkinson/NeuralAmpModelerCore.git
  GIT_TAG 0b3d3c97b0859a3a8c92a8628c4dd89a25eb5842
  GIT_SUBMODULES_RECURSE TRUE
  SOURCE_SUBDIR __vttrig_do_not_add_upstream_tools
)
FetchContent_MakeAvailable(namcore)

find_package(PkgConfig REQUIRED)
pkg_check_modules(JACK REQUIRED IMPORTED_TARGET jack)

file(GLOB NAM_SOURCES CONFIGURE_DEPENDS
  "${namcore_SOURCE_DIR}/NAM/*.cpp"
  "${namcore_SOURCE_DIR}/NAM/*.c"
  "${namcore_SOURCE_DIR}/NAM/*/*.cpp"
)

add_library(vttrig_nam_core STATIC ${NAM_SOURCES})
target_compile_features(vttrig_nam_core PUBLIC cxx_std_20)
target_compile_definitions(vttrig_nam_core PUBLIC NAM_ENABLE_A2_FAST)
target_include_directories(vttrig_nam_core SYSTEM PUBLIC
  "${namcore_SOURCE_DIR}"
  "${namcore_SOURCE_DIR}/Dependencies/eigen"
  "${namcore_SOURCE_DIR}/Dependencies/nlohmann"
  "${namcore_SOURCE_DIR}/Dependencies/AudioDSPTools/dsp"
)

add_executable(vttrig-nam-jack src/nam_jack.cpp)
target_compile_features(vttrig-nam-jack PRIVATE cxx_std_20)
target_link_libraries(vttrig-nam-jack PRIVATE vttrig_nam_core PkgConfig::JACK)
target_compile_options(vttrig-nam-jack PRIVATE -Wall -Wextra -Wpedantic)
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  target_link_libraries(vttrig-nam-jack PRIVATE stdc++fs)
endif()

include(CTest)
if(BUILD_TESTING)
  add_test(NAME nam_engine_help COMMAND vttrig-nam-jack --help)
endif()
