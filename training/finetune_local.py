#!/usr/bin/env python3
"""
Local fine-tuning script for Qwen2.5-3B-Instruct.
Runs on CPU with 64GB RAM (no NVIDIA GPU required).

Usage:
    pip install torch transformers datasets peft trl accelerate
    python training/finetune_local.py --dataset training/dataset.jsonl [--output ./model-output]

For GGUF export after training:
    pip install llama-cpp-python
    python training/finetune_local.py --dataset training/dataset.jsonl --export-gguf
"""

import argparse
import gc
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import torch
from datasets import load_dataset
from peft import LoraConfig, get_peft_model, PeftModel
from transformers import AutoTokenizer, AutoModelForCausalLM
from trl import SFTTrainer, SFTConfig

# ─── Defaults ────────────────────────────────────────────────────────

MODEL_ID = "Qwen/Qwen2.5-3B-Instruct"
DEFAULT_OUTPUT = "./qwen-medical-validator"
DEFAULT_EPOCHS = 3
DEFAULT_BATCH_SIZE = 1
DEFAULT_GRAD_ACCUM = 8
DEFAULT_LR = 2e-4
DEFAULT_LORA_R = 16
DEFAULT_LORA_ALPHA = 32
DEFAULT_MAX_SEQ_LEN = 2048


def parse_args():
    parser = argparse.ArgumentParser(description="Fine-tune Qwen2.5-3B for medical validation")
    parser.add_argument("--dataset", required=True, help="Path to dataset.jsonl")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="Output directory")
    parser.add_argument("--model", default=MODEL_ID, help="Base model ID")
    parser.add_argument("--epochs", type=int, default=DEFAULT_EPOCHS)
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--lr", type=float, default=DEFAULT_LR)
    parser.add_argument("--lora-r", type=int, default=DEFAULT_LORA_R)
    parser.add_argument("--lora-alpha", type=int, default=DEFAULT_LORA_ALPHA)
    parser.add_argument("--export-gguf", action="store_true", help="Export to GGUF after training")
    parser.add_argument("--resume", action="store_true", help="Resume from latest checkpoint")
    return parser.parse_args()


def load_data(dataset_path: str):
    dataset = load_dataset("json", data_files=dataset_path, split="train")
    split = dataset.train_test_split(test_size=0.1, seed=42)
    print(f"Train: {len(split['train'])}, Eval: {len(split['test'])}")
    return split["train"], split["test"]


def train(args):
    import psutil
    ram_gb = psutil.virtual_memory().total / 1e9
    print(f"Device: CPU ({os.cpu_count()} cores)")
    print(f"RAM: {ram_gb:.1f} GB")
    print(f"PyTorch: {torch.__version__}")

    train_dataset, eval_dataset = load_data(args.dataset)

    # Load model in float32 on CPU (no quantization — we have 64GB RAM)
    tokenizer = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True)
    tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    print(f"Loading {args.model} in float32 on CPU...")
    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        torch_dtype=torch.float32,
        device_map="cpu",
        trust_remote_code=True,
    )
    model.config.use_cache = False
    model.enable_input_require_grads()

    print(f"Model: {args.model} ({model.num_parameters() / 1e9:.1f}B params)")

    # LoRA config
    lora_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        target_modules="all-linear",
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora_config)

    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"Trainable: {trainable / 1e6:.1f}M / {total / 1e9:.1f}B ({100 * trainable / total:.2f}%)")

    # Format into chat template
    def format_chat(example):
        text = tokenizer.apply_chat_template(
            example["messages"],
            tokenize=False,
            add_generation_prompt=False,
        )
        return {"text": text}

    train_formatted = train_dataset.map(format_chat)
    eval_formatted = eval_dataset.map(format_chat)

    # Training config — CPU: no bf16, no gradient checkpointing kwargs
    training_args = SFTConfig(
        output_dir=args.output,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=DEFAULT_GRAD_ACCUM,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.1,
        bf16=False,
        fp16=False,
        gradient_checkpointing=True,
        logging_steps=5,
        eval_strategy="steps",
        eval_steps=50,
        save_strategy="steps",
        save_steps=10,
        save_total_limit=3,
        max_length=DEFAULT_MAX_SEQ_LEN,
        report_to="none",
        dataloader_num_workers=0,
        use_cpu=True,
    )

    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=train_formatted,
        eval_dataset=eval_formatted,
    )

    ram_used = psutil.virtual_memory().percent
    print(f"RAM usage after setup: {ram_used:.1f}%")
    print(f"Starting training at {time.strftime('%H:%M:%S')}...")
    print(f"Estimated: 4-8 hours for {len(train_formatted)} examples x {args.epochs} epochs on CPU")

    start = time.time()
    trainer.train(resume_from_checkpoint=args.resume)
    elapsed = time.time() - start
    print(f"Training complete in {elapsed / 3600:.1f} hours")

    # Save LoRA adapters
    adapter_dir = os.path.join(args.output, "lora-adapters")
    trainer.save_model(adapter_dir)
    tokenizer.save_pretrained(adapter_dir)
    print(f"LoRA adapters saved to {adapter_dir}")

    # Final metrics
    metrics = trainer.state.log_history
    train_losses = [m["loss"] for m in metrics if "loss" in m]
    eval_losses = [m["eval_loss"] for m in metrics if "eval_loss" in m]
    print(f"\nFinal train loss: {train_losses[-1]:.4f}")
    if eval_losses:
        print(f"Final eval loss:  {eval_losses[-1]:.4f}")

    # Merge
    print("Merging LoRA into base model...")
    del trainer
    gc.collect()

    merged = model.merge_and_unload()
    merged_dir = os.path.join(args.output, "merged")
    merged.save_pretrained(merged_dir)
    tokenizer.save_pretrained(merged_dir)
    print(f"Merged model saved to {merged_dir}")

    del merged
    gc.collect()

    if args.export_gguf:
        export_gguf(merged_dir, args.output)


def export_gguf(merged_dir: str, output_dir: str):
    gguf_path = os.path.join(output_dir, "medical-validator-q4_k_m.gguf")

    convert_script = "/tmp/llama.cpp/convert_hf_to_gguf.py"
    if not os.path.exists(convert_script):
        print("Cloning llama.cpp for GGUF conversion...")
        subprocess.run(
            ["git", "clone", "--depth", "1", "https://github.com/ggerganov/llama.cpp", "/tmp/llama.cpp"],
            check=True,
        )
        req_file = "/tmp/llama.cpp/requirements/requirements-convert_hf_to_gguf.txt"
        if os.path.exists(req_file):
            subprocess.run(
                [sys.executable, "-m", "pip", "install", "-q", "-r", req_file],
                check=True,
            )

    print("Converting to GGUF (Q4_K_M)...")
    subprocess.run(
        [sys.executable, convert_script, merged_dir, "--outfile", gguf_path, "--outtype", "q4_k_m"],
        check=True,
    )

    size_mb = os.path.getsize(gguf_path) / (1024 * 1024)
    print(f"GGUF exported: {gguf_path} ({size_mb:.0f} MB)")

    # Write Ollama Modelfile
    modelfile_path = os.path.join(output_dir, "Modelfile")
    with open(modelfile_path, "w") as f:
        f.write('FROM ./medical-validator-q4_k_m.gguf\n\n')
        f.write('PARAMETER temperature 0\n')
        f.write('PARAMETER num_ctx 2048\n')
        f.write('PARAMETER stop <|im_end|>\n\n')
        f.write('TEMPLATE """{{ if .System }}<|im_start|>system\n')
        f.write('{{ .System }}<|im_end|>\n')
        f.write('{{ end }}<|im_start|>user\n')
        f.write('{{ .Prompt }}<|im_end|>\n')
        f.write('<|im_start|>assistant\n')
        f.write('"""\n')

    print(f"\nTo load in Ollama:")
    print(f"  cd {output_dir}")
    print(f"  ollama create medical-validator -f Modelfile")


if __name__ == "__main__":
    args = parse_args()
    train(args)
