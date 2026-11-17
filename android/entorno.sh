# android/entorno.sh — variables para compilar DictaFlow para Android. Se carga con `source`.
#
# whisper.cpp y llama.cpp son C/C++ y se compilan con CMake usando el NDK; bindgen (que genera
# las interfaces de Rust) necesita los encabezados del NDK para el destino arm64.
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export NDK_HOME="${NDK_HOME:-$(ls -d "$ANDROID_HOME"/ndk/* | sort -V | tail -1)}"
export ANDROID_NDK="$NDK_HOME" ANDROID_NDK_ROOT="$NDK_HOME"
_tc="$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64"
_clang_inc="$(ls -d "$_tc"/lib/clang/*/include | sort -V | tail -1)"
export BINDGEN_EXTRA_CLANG_ARGS_aarch64_linux_android="--target=aarch64-linux-android26 --sysroot=$_tc/sysroot -I$_clang_inc"
# whisper.cpp / llama.cpp (ggml): sin esto se compilan para ARMv8 básico y van varias veces más
# lentos. dotprod + fp16 los tienen los teléfonos de los últimos ~6 años (Cortex-A55/A76 en
# adelante); en uno más antiguo la app no podría ejecutar la IA local.
export GGML_NATIVE=OFF GGML_CPU_ARM_ARCH="armv8.2-a+dotprod+fp16"
# Flags del sistema pensadas para compilar en la PC (p. ej. librerías de cursos) no deben colarse
# en la compilación para el teléfono.
unset CFLAGS CXXFLAGS LDFLAGS CPPFLAGS
unset _tc _clang_inc
