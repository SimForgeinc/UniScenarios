from pathlib import Path

_PROMPTS_DIR = Path(__file__).parent

def load_prompt(prompt_name: str) -> str:
    prompt_file = _PROMPTS_DIR / f"{prompt_name}.txt"
    
    if not prompt_file.exists():
        raise FileNotFoundError(
            f"Prompt file not found: {prompt_file}. "
            f"Available prompts: {', '.join(get_available_prompts())}"
        )
    
    with open(prompt_file, 'r', encoding='utf-8') as f:
        return f.read().strip()


def get_available_prompts() -> list[str]:
    return [
        f.stem 
        for f in _PROMPTS_DIR.glob("*.txt")
        if f.is_file()
    ]


__all__ = ["load_prompt"]


