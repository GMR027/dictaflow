#![allow(non_upper_case_globals)]
#![allow(non_camel_case_types)]
#![allow(non_snake_case)]

include!(concat!(env!("OUT_DIR"), "/bindings.rs"));

// DictaFlow: whisper.cpp usa el ggml que compila llama-cpp-sys-2. Se carga ese crate de forma
// explícita para que sus bibliotecas (ggml) se enlacen aunque la app no use llama.cpp todavía.
extern crate llama_cpp_sys_2;
