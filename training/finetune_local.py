#!/usr/bin/env python3
"""
Local fine-tuning script for Qwen2.5-3B-Instruct.
Requires: NVIDIA GPU with 16GB+ VRAM (or 8GB with reduced batch size).

Usage:
    pip install torch transformers datasets peft trl bitsandbytes accelerate
    python training/finetune_local.py --dataset training/dataset.jsonl [--output ./model-output]

For GGUF export after training:
    pip install llama-cpp-python
    python training/finetune_local.py --dataset training/dataset.jsonl --export-gguf
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import torch
from datasets import load_dataset
from peft import LoraConfig, prepare_model_for_kbit_training, PeftModel
from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
from trl import SFTTrainer, SFTConfig

# ─── Defaults ────────────────────────────────────────────────────────

MODEL_ID = "Qwen/Qwen2.5-3B-Instruct"
DEFAULT_OUTPUT = "./qwen-medical-validator"
DEFAULT_EPOCHS = 3
DEFAULT_BATCH_SIZE = 4
DEFAULT_GRAD_ACCUM = 2
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
    parser.add_argument("--eval-only", action="store_true", help="Only run evaluation on existing model")
    return parser.parse_args()


def load_data(dataset_path: str):
    dataset = load_dataset("json", data_files=dataset_path, split="train")
    split = dataset.train_test_split(test_size=0.1, seed=42)
    print(f"Train: {len(split['train'])}, Eval: {len(split['test'])}")
    return split["train"], split["test"]


def train(args):
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"VRAM: {torch.cuda.get_device_properties(0).total_mem / 1e9:.1f} GB")

    train_dataset, eval_dataset = load_data(args.dataset)

    # Load model in 4-bit
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )

    tokenizer = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True)
    tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        quantization_config=bnb_config,
        device_map="auto",
        trust_remote_code=True,
    )
    model.config.use_cache = False
    model = prepare_model_for_kbit_training(model)

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

    # Training config
    training_args = SFTConfig(
        output_dir=args.output,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=DEFAULT_GRAD_ACCUM,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.1,
        bf16=True,
        logging_steps=10,
        eval_strategy="steps",
        eval_steps=50,
        save_strategy="steps",
        save_steps=100,
        save_total_limit=2,
        max_seq_length=DEFAULT_MAX_SEQ_LEN,
        dataset_kwargs={"skip_prepare_dataset": True},
        report_to="none",
    )

    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=train_formatted,
        eval_dataset=eval_formatted,
        peft_config=lora_config,
    )

    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"Trainable parameters: {trainable / 1e6:.1f}M")
    print("Starting training...")

    trainer.train()

    # Save LoRA adapters
    adapter_dir = os.path.join(args.output, "lora-adapters")
    trainer.save_model(adapter_dir)
    tokenizer.save_pretrained(adapter_dir)
    print(f"LoRA adapters saved to {adapter_dir}")

    # Merge
    print("Merging LoRA into base model...")
    del model
    torch.cuda.empty_cache()

    base_model = AutoModelForCausalLM.from_pretrained(
        args.model,
        torch_dtype=torch.float16,
        device_map="auto",
        trust_remote_code=True,
    )
    merged = PeftModel.from_pretrained(base_model, adapter_dir)
    merged = merged.merge_and_unload()

    merged_dir = os.path.join(args.output, "merged")
    merged.save_pretrained(merged_dir)
    tokenizer.save_pretrained(merged_dir)
    print(f"Merged model saved to {merged_dir}")

    # Final metrics
    metrics = trainer.state.log_history
    train_losses = [m["loss"] for m in metrics if "loss" in m]
    eval_losses = [m["eval_loss"] for m in metrics if "eval_loss" in m]
    print(f"\nFinal train loss: {train_losses[-1]:.4f}")
    if eval_losses:
        print(f"Final eval loss:  {eval_losses[-1]:.4f}")

    if args.export_gguf:
        export_gguf(merged_dir, args.output)


def export_gguf(merged_dir: str, output_dir: str):
    gguf_path = os.path.join(output_dir, "medical-validator-q4_k_m.gguf")

    # Check if llama.cpp convert script is available
    convert_script = "/tmp/llama.cpp/convert_hf_to_gguf.py"
    if not os.path.exists(convert_script):
        print("Cloning llama.cpp for GGUF conversion...")
        subprocess.run(
            ["git", "clone", "--depth", "1", "https://github.com/ggerganov/llama.cpp", "/tmp/llama.cpp"],
            check=True,
        )
        subprocess.run(
            ["pip", "install", "-q", "-r", "/tmp/llama.cpp/requirements/requirements-convert_hf_to_gguf.txt"],
            check=True,
        )

    print("Converting to GGUF (Q4_K_M)...")
    subprocess.run(
        ["python", convert_script, merged_dir, "--outfile", gguf_path, "--outtype", "q4_k_m"],
        check=True,
    )

    size_mb = os.path.getsize(gguf_path) / (1024 * 1024)
    print(f"GGUF exported: {gguf_path} ({size_mb:.0f} MB)")

    # Write Ollama Modelfile
    modelfile_path = os.path.join(output_dir, "Modelfile")
    modelfile = """FROM ./medical-validator-q4_k_m.gguf

PARAMETER temperature 0
PARAMETER num_ctx 2048
PARAMETER stop <|im_end|>

TEMPLATE \"\"\"{{ if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}<|im_start|>user
{{ .Prompt }}<|im_end|>
<|im_start|>assistant
\"\"\"
"""
    with open(modelfile_path, "w") as f:
        f.write(modelfile)

    print(f"\nTo load in Ollama:")
    print(f"  cd {output_dir}")
    print(f"  ollama create medical-validator -f Modelfile")


if __name__ == "__main__":
    args = parse_args()
    if not torch.cuda.is_available():
        print("ERROR: No CUDA GPU detected. Use the Colab notebook instead.")
        sys.exit(1)
    train(args)
