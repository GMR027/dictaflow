# Third-party software / Software de terceros

DictaFlow is MIT licensed. It uses the following components. / DictaFlow usa estos componentes.

## Bundled in the app / Incluido en la app

| Component | License | Use |
|---|---|---|
| [Electron](https://www.electronjs.org) | MIT | App shell |
| [React](https://react.dev), [Zustand](https://github.com/pmndrs/zustand) | MIT | UI |
| [Transformers.js](https://github.com/huggingface/transformers.js) + [ONNX Runtime](https://onnxruntime.ai) | Apache-2.0 / MIT | Local speech recognition |
| [PDF.js](https://github.com/mozilla/pdf.js) | Apache-2.0 | PDF reader |
| [JSZip](https://stuk.github.io/jszip/) | MIT or GPL-3.0 (used under MIT) | EPUB reader |
| [lamejs (@breezystack/lamejs)](https://github.com/breezystack/lamejs) | LGPL-3.0 | MP3 encoding. Linked as a separate, replaceable module bundle. |

## Downloaded on demand, not redistributed / Descargado bajo demanda

These are fetched from their official sources only when you choose to install them.
Se descargan de su fuente oficial solo cuando tú lo eliges.

| Component | License | Source |
|---|---|---|
| Whisper models (Xenova ONNX conversions) | MIT (OpenAI Whisper) | Hugging Face |
| [Piper](https://github.com/rhasspy/piper) TTS engine (bundles espeak-ng, GPL-3.0) | MIT | GitHub Releases |
| Piper voices | **Each voice has its own license** — check the voice's `MODEL_CARD` in [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) before commercial use | Hugging Face |
| [Ollama](https://ollama.com) | MIT | ollama.com installer (optional) |

DictaFlow is an independent project and is not affiliated with OpenAI, Anthropic, Hugging Face, Ollama or Zorin. / DictaFlow es un proyecto independiente.
