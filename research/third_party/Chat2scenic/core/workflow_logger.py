from datetime import datetime
from pathlib import Path
from typing import Optional


class WorkflowLogger:
    def __init__(self, base_dir: str = "results"):
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(exist_ok=True)
        self.workflow_dir: Optional[Path] = None
        self.step_counter = 0
        self.current_step_name = ""
    
    def create_workflow_folder(self, user_query: str = "") -> Path:
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        if user_query:
            query_part = user_query[:30].strip()
            # Remove invalid characters for Windows folder names
            invalid_chars = '<>:"/\\|?*'
            for char in invalid_chars:
                query_part = query_part.replace(char, '')
            query_part = "".join(c if c.isalnum() or c in (' ', '-', '_') else '' for c in query_part)
            query_part = query_part.replace(' ', '_').strip('_')
            if query_part:
                folder_name = f"{timestamp}_{query_part}"
            else:
                folder_name = timestamp
        else:
            folder_name = timestamp
        
        self.workflow_dir = self.base_dir / folder_name
        self.workflow_dir.mkdir(exist_ok=True)
        self.step_counter = 0
        
        if user_query:
            query_file = self.workflow_dir / "query.txt"
            query_file.write_text(user_query, encoding='utf-8')
        
        return self.workflow_dir
    
    def log_step(self, step_name: str, prompt: str, response: str) -> Path:
        if not self.workflow_dir:
            raise ValueError("Workflow folder not created. Call create_workflow_folder() first.")
        
        self.step_counter += 1
        self.current_step_name = step_name
        
        sanitized_step_name = step_name.replace(' ', '_').replace('/', '_').replace('\\', '_')
        invalid_chars = '<>:"|?*'
        for char in invalid_chars:
            sanitized_step_name = sanitized_step_name.replace(char, '')
        
        log_file = self.workflow_dir / f"{self.step_counter}.{sanitized_step_name}.txt"
        
        log_content = f"Step {self.step_counter}: {step_name}\n"
        log_content += "=" * 80 + "\n\n"
        log_content += "Formatted Prompt (with parameter values):\n"
        log_content += "-" * 80 + "\n\n"
        log_content += prompt
        log_content += "\n\n"
        log_content += "=" * 80 + "\n\n"
        log_content += "Response:\n"
        log_content += "-" * 80 + "\n\n"
        log_content += response
        
        log_file.write_text(log_content, encoding='utf-8')
        
        return log_file
    
    def log_state(self, step_name: str, state: dict) -> Path:
        content = "Workflow State:\n\n"
        for key, value in state.items():
            if key == "messages":
                content += f"{key}: {len(value)} message(s)\n"
            elif isinstance(value, dict):
                content += f"{key}:\n"
                for sub_key, sub_value in value.items():
                    if isinstance(sub_value, str) and len(sub_value) > 500:
                        content += f"  {sub_key}: {sub_value[:500]}... (truncated)\n"
                    else:
                        content += f"  {sub_key}: {sub_value}\n"
            elif isinstance(value, str) and len(value) > 1000:
                content += f"{key}: {value[:1000]}... (truncated, total length: {len(value)})\n"
            else:
                content += f"{key}: {value}\n"
        
        return self.log_step(step_name, content, state)
    
    def get_workflow_dir(self) -> Optional[Path]:
        return self.workflow_dir

