//! Redacción con IA dentro del teléfono: llama.cpp con modelos GGUF descargados en `modelos/`.
//!
//! Los prompts no viven aquí: los arma `src/shared/llm-tasks.ts` (los mismos que en escritorio) y
//! llegan como mensajes de chat. Rust aplica la plantilla de chat del propio modelo, genera la
//! respuesta y la devuelve completa. Las peticiones se atienden de una en una.
//!
//! El modelo y su contexto se quedan cargados entre peticiones, y el contexto recuerda los tokens
//! que ya leyó: como cada redacción empieza con el mismo prompt de sistema, solo se lee lo nuevo
//! (en el teléfono, leer el prompt es la mitad del tiempo de una frase).

use std::num::NonZeroU32;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::context::LlamaContext;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{LlamaChatMessage, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::token::LlamaToken;
use serde::{Deserialize, Serialize};

use crate::modelos::{archivo_valido, contexto_llm, limpiar_respuesta, prefijo_comun};

/// Tokens que se procesan de una vez al leer el prompt.
const LOTE: usize = 512;
/// Contexto mínimo que se reserva, para no recrearlo en cada petición algo más larga.
const CTX_INICIAL: u32 = 4096;

#[derive(Deserialize)]
pub struct Mensaje {
    pub role: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct Respuesta {
    text: String,
    /// Tokens del prompt (y cuántos venían ya leídos), generados y milisegundos de cada fase.
    prompt_tokens: usize,
    reused_tokens: usize,
    tokens: usize,
    prompt_ms: u128,
    ms: u128,
}

/// Modelo cargado con su contexto. El modelo se reserva en el montón con vida `'static` para
/// que el contexto (que lo toma prestado) pueda guardarse a su lado; se libera en `drop`.
struct Motor {
    id: String,
    modelo: &'static LlamaModel,
    ctx: Option<LlamaContext<'static>>,
    /// Tokens que hay ahora en la caché del contexto (secuencia 0), en orden de posición.
    leidos: Vec<LlamaToken>,
}

impl Drop for Motor {
    fn drop(&mut self) {
        // Primero el contexto, que usa el modelo; luego el modelo.
        self.ctx = None;
        // SAFETY: `modelo` salió de `Box::leak` en `cargar_en` y nada más lo referencia ya.
        unsafe { drop(Box::from_raw(self.modelo as *const LlamaModel as *mut LlamaModel)) };
    }
}

pub struct Llm {
    dir: PathBuf,
    backend: LlamaBackend,
    motor: Mutex<Option<Motor>>,
}

fn hilos() -> i32 {
    // Los teléfonos tienen 4 núcleos rápidos y 4 de bajo consumo: más hilos no aceleran.
    std::thread::available_parallelism().map(|n| n.get().min(4)).unwrap_or(4) as i32
}

impl Llm {
    pub fn new(dir: PathBuf) -> Result<Self, String> {
        let backend = LlamaBackend::init().map_err(|e| format!("No se pudo iniciar llama.cpp: {e}"))?;
        Ok(Self { dir, backend, motor: Mutex::new(None) })
    }

    pub fn cargado(&self) -> Option<String> {
        self.motor.lock().unwrap().as_ref().map(|m| m.id.clone())
    }

    /// Carga el modelo (si no es el que ya está cargado).
    pub fn cargar(&self, id: &str) -> Result<(), String> {
        let mut motor = self.motor.lock().unwrap();
        self.cargar_en(&mut motor, id)
    }

    fn cargar_en(&self, motor: &mut Option<Motor>, id: &str) -> Result<(), String> {
        if id.is_empty() {
            return Err("Descarga un modelo de redacción en Ajustes → Servicios de IA.".into());
        }
        if !archivo_valido(id) || !id.ends_with(".gguf") {
            return Err(format!("Modelo de redacción no válido: «{id}»."));
        }
        if motor.as_ref().is_some_and(|m| m.id == id) {
            return Ok(());
        }
        let ruta = self.dir.join(id);
        if !ruta.is_file() {
            return Err("El modelo de redacción elegido no está descargado. Descárgalo en Ajustes → Servicios de IA.".into());
        }
        // Se libera el anterior antes de cargar otro: no caben dos en la RAM de un teléfono.
        *motor = None;
        let modelo = LlamaModel::load_from_file(&self.backend, &ruta, &LlamaModelParams::default())
            .map_err(|e| format!("No se pudo cargar el modelo de redacción: {e}"))?;
        *motor = Some(Motor { id: id.to_string(), modelo: Box::leak(Box::new(modelo)), ctx: None, leidos: Vec::new() });
        Ok(())
    }

    /// Genera la respuesta del asistente a una conversación (`system` + mensajes).
    pub fn completar(&self, id: &str, system: &str, mensajes: &[Mensaje], temperatura: f32) -> Result<Respuesta, String> {
        let mut guardia = self.motor.lock().unwrap();
        self.cargar_en(&mut guardia, id)?;
        let motor = guardia.as_mut().expect("modelo cargado");
        let modelo = motor.modelo;

        // Prompt con la plantilla de chat del modelo (Qwen, Gemma y Llama tienen formatos distintos).
        let plantilla = modelo.chat_template(None).map_err(|_| "El modelo no trae plantilla de chat.".to_string())?;
        let mut chat = Vec::with_capacity(mensajes.len() + 1);
        if !system.trim().is_empty() {
            chat.push(LlamaChatMessage::new("system".into(), system.into()).map_err(|e| e.to_string())?);
        }
        for m in mensajes {
            let rol = if m.role == "assistant" { "assistant" } else { "user" };
            chat.push(LlamaChatMessage::new(rol.into(), m.content.clone()).map_err(|e| e.to_string())?);
        }
        let prompt = modelo.apply_chat_template(&plantilla, &chat, true).map_err(|e| format!("No se pudo preparar el prompt: {e}"))?;

        let vocab = modelo.vocab();
        // Algunas plantillas (Gemma) ya escriben el token de inicio: no se duplica.
        let bos = String::from_utf8_lossy(&vocab.token_to_piece(vocab.bos(), true, None)).into_owned();
        let con_bos = vocab.should_add_bos() && (bos.is_empty() || !prompt.starts_with(&bos));
        let tokens = vocab.tokenize(prompt.as_bytes(), con_bos, true);
        let (n_ctx, max_nuevos) = contexto_llm(tokens.len(), modelo.n_ctx_train())?;

        // Contexto: se reutiliza si cabe la petición; si no, se crea uno mayor (y se olvida la caché).
        if motor.ctx.as_ref().is_none_or(|c| c.n_ctx() < n_ctx) {
            motor.ctx = None;
            motor.leidos.clear();
            let tamaño = n_ctx.max(CTX_INICIAL.min(modelo.n_ctx_train().max(n_ctx)));
            let params = LlamaContextParams::default()
                .with_n_ctx(NonZeroU32::new(tamaño))
                .with_n_batch(LOTE as u32)
                .with_n_threads(hilos())
                .with_n_threads_batch(hilos());
            motor.ctx = Some(modelo.new_context(&self.backend, params).map_err(|e| format!("No hay memoria para el modelo de redacción: {e}"))?);
        }
        let ctx = motor.ctx.as_mut().expect("contexto creado");

        // 1) Lectura del prompt: se conserva lo que ya estaba leído (el mismo inicio) y se lee el
        // resto por lotes; solo el último token necesita sus probabilidades.
        let inicio = Instant::now();
        let mut comun = prefijo_comun(&motor.leidos, &tokens);
        // Algunos modelos (ventana deslizante, p. ej. Gemma) no permiten borrar solo una parte.
        if !ctx.clear_kv_cache_seq(Some(0), Some(comun as u32), None).unwrap_or(false) {
            ctx.clear_kv_cache();
            comun = 0;
        }
        motor.leidos.truncate(comun);
        let mut lote = LlamaBatch::new(LOTE, 1);
        for trozo in tokens[comun..].chunks(LOTE) {
            lote.clear();
            for t in trozo {
                let pos = motor.leidos.len();
                lote.add(*t, pos as i32, &[0], pos == tokens.len() - 1).map_err(|e| e.to_string())?;
                motor.leidos.push(*t);
            }
            if let Err(e) = ctx.decode(&mut lote) {
                motor.leidos.clear();
                ctx.clear_kv_cache();
                return Err(format!("Error del modelo al leer el texto: {e}"));
            }
        }
        let prompt_ms = inicio.elapsed().as_millis();

        // 2) Generación, token a token, hasta el fin de respuesta del modelo o el límite.
        // Penalización suave a las repeticiones: los modelos pequeños tienden a entrar en bucle.
        let t = temperatura.clamp(0.0, 2.0);
        let repeticion = || LlamaSampler::penalties(modelo.n_vocab(), 64, 1.1, 0.0, 0.0);
        let mut muestreo = if t <= 0.0 {
            LlamaSampler::chain_simple([repeticion(), LlamaSampler::greedy()])
        } else {
            LlamaSampler::chain_simple([
                repeticion(),
                LlamaSampler::top_k(40),
                LlamaSampler::top_p(0.95, 1),
                LlamaSampler::min_p(0.05, 1),
                LlamaSampler::temp(t),
                LlamaSampler::dist(inicio.elapsed().subsec_nanos() ^ 0x5eed),
            ])
        };
        let mut salida: Vec<u8> = Vec::new();
        let mut generados = 0;
        while generados < max_nuevos {
            let token = muestreo.sample(ctx, lote.n_tokens() - 1);
            if vocab.is_eog(token) {
                break;
            }
            vocab.token_to_piece_into(token, &mut salida, false, None);
            generados += 1;
            lote.clear();
            lote.add(token, motor.leidos.len() as i32, &[0], true).map_err(|e| e.to_string())?;
            motor.leidos.push(token);
            if let Err(e) = ctx.decode(&mut lote) {
                motor.leidos.clear();
                ctx.clear_kv_cache();
                return Err(format!("Error del modelo al redactar: {e}"));
            }
        }

        Ok(Respuesta {
            text: limpiar_respuesta(&String::from_utf8_lossy(&salida)),
            prompt_tokens: tokens.len(),
            reused_tokens: comun,
            tokens: generados,
            prompt_ms,
            ms: inicio.elapsed().as_millis(),
        })
    }
}
