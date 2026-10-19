# Banco de pruebas STT

Reproduce el pipeline de `src/main/stt-worker.ts` (Transformers.js + Whisper) fuera de Electron, sobre audio fijo.

1. Corpus: FLEURS es_419 (test). `test.tsv` + un `.tar.gz` de audio extraído en `<dir>/test/`.
   Los WAV son float32 a 16 kHz; el lector admite también int16.
2. `npm ci`
3. `node bench/stt-bench.mjs --data <dir> --model Xenova/whisper-small --dtype q8 --n 30 --cache <dir modelos> --out res.json`
   - `--maxsec 3` recorta cada clip (solo mide latencia; el WER deja de ser válido).
   - `--chunk` / `--stride` replican `chunk_length_s` / `stride_length_s`.

Limitaciones: corre en Node, no en el Electron empaquetado. Los clips de FLEURS son frases leídas y
limpias (~12 s), más largas que un dictado típico. No mide ruido, ni CPU/GPU, ni VRAM, ni el VAD.

## Otros scripts y opciones
- `--repeat N`: N pasadas sobre los mismos clips; el JSON incluye `rssByPassMB` y el p50 de la primera y la última pasada (estabilidad).
- `--extra '{"no_repeat_ngram_size":3,"max_new_tokens":200}'`: opciones extra de generación.
- `node bench/llm-bench.mjs <modelo-ollama> [num_ctx] [keep_alive]`: latencia de redacción con el prompt de la app y comprobación de cifras
  (`NO_NUM_RULE=1` omite la regla de cifras del prompt). Necesita Ollama en marcha y Node ≥ 22.13.
- Pruebas automáticas: `npm test`. Empaquetado: `npm run dist:dir`.
