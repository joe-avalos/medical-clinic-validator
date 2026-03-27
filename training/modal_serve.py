"""
Modal deployment for the fine-tuned Qwen medical-validator model.

Serves the GGUF via llama.cpp's built-in OpenAI-compatible server on a T4 GPU.
Scale-to-zero — you only pay for GPU-seconds during inference.

Setup (one-time):
    pip install modal
    modal setup          # authenticates with your Modal account
    modal volume create medical-validator-vol

Upload model (one-time):
    modal volume put medical-validator-vol \
        training/ollama-model/medical-validator-q4_k_m.gguf \
        /model/medical-validator-q4_k_m.gguf

Deploy:
    modal deploy training/modal_serve.py

Test:
    curl https://<your-app>--medical-validator-inference.modal.run/v1/chat/completions \\
        -H "Content-Type: application/json" \\
        -d '{"model":"medical-validator","messages":[{"role":"user","content":"test"}]}'

Then set in .env:
    QWEN_OLLAMA_URL=https://<your-app>--medical-validator-inference.modal.run
"""

import modal

# ---------------------------------------------------------------------------
# Modal resources
# ---------------------------------------------------------------------------

app = modal.App("medical-validator")

# Persistent volume for the GGUF file (~1.8GB, survives redeploys)
volume = modal.Volume.from_name("medical-validator-vol", create_if_missing=True)

# Container image: CUDA base + llama-cpp-python with server extras
image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.1-runtime-ubuntu22.04",
        add_python="3.11",
    )
    .apt_install("curl", "build-essential", "cmake")
    .pip_install(
        "llama-cpp-python[server]",
        extra_options="--extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu124",
    )
)

GGUF_PATH = "/model/model/medical-validator-q4_k_m.gguf"

# Qwen chat template (Chatml format)
CHAT_TEMPLATE = (
    "{% for message in messages %}"
    "<|im_start|>{{ message.role }}\n{{ message.content }}<|im_end|>\n"
    "{% endfor %}"
    "<|im_start|>assistant\n"
)

# ---------------------------------------------------------------------------
# Web endpoint — OpenAI-compatible /v1/chat/completions
# ---------------------------------------------------------------------------

@app.function(
    image=image,
    gpu="T4",
    volumes={"/model": volume},
    scaledown_window=300,  # keep warm for 5 min after last request
    timeout=120,
)
@modal.asgi_app()
def inference():
    """Starts llama-cpp-python's OpenAI-compatible server."""
    from pathlib import Path
    from llama_cpp.server.app import create_app, Settings

    if not Path(GGUF_PATH).exists():
        raise FileNotFoundError(
            f"GGUF not found at {GGUF_PATH}. "
            "Run: modal volume put medical-validator-vol "
            "training/ollama-model/medical-validator-q4_k_m.gguf "
            "/model/medical-validator-q4_k_m.gguf"
        )

    settings = Settings(
        model=GGUF_PATH,
        model_alias="medical-validator",
        n_ctx=2048,
        n_gpu_layers=-1,  # offload all layers to GPU
        chat_format="chatml",
        verbose=False,
    )

    return create_app(settings=settings)
