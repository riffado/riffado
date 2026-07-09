// Aliased in for `onnxruntime-node` and `sharp`, the Node-only optional
// dependencies of `@xenova/transformers`. Browser transcription runs
// Transformers.js exclusively in a browser Web Worker (onnxruntime-web),
// so these native packages must never be resolved by the bundler.
//
// Transformers.js statically references both a default import
// (`import sharp from 'sharp'`) and a namespace `.default` access
// (`ONNX_NODE.default ?? ONNX_NODE`), so the stub must expose a default
// export. Neither branch is invoked in the browser runtime.
const stub = {};
export default stub;
